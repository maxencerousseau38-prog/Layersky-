import { CHECK_NAME, publishCheck } from '@/lib/github/checks';
import { readGitHubApp } from '@/lib/github/config';
import { materialiseRepository } from '@/lib/github/materialise';
import { decideWebhook, verifySignature } from '@/lib/github/webhook';
import { analysePullRequest, discardCheckout } from '@/lib/i18n/analyse';
import type { AuditReport } from '@localize-infra/eval';
import { App } from 'octokit';

/**
 * GitHub delivers here when a pull request opens or is pushed to.
 *
 * ## Public, deliberately, and authenticated by signature instead
 *
 * This is the second route in the product a signed-out request may reach, after
 * `/api/version`. It has to be: GitHub holds no session. The allow-list in
 * `lib/supabase/session.ts` is the one place that decides, so this route is
 * added there rather than being special-cased in the proxy — a second copy of
 * an allow-list is the copy that drifts.
 *
 * What replaces the session is the HMAC over the raw body. Every refusal below
 * returns 2xx or 4xx quickly and does no work; nothing reaches a repository
 * before the signature has been checked.
 *
 * ## Why refusals answer 200 and not 4xx
 *
 * GitHub retries a delivery that fails and marks the hook unhealthy after
 * enough of them. "I looked and there was nothing to do" is not a failure, so a
 * draft pull request or an ignored event answers 200 with a reason. A bad
 * signature answers 401, because that one genuinely should be visible in the
 * delivery log.
 *
 * ## The timeout is still the ceiling, and this is sized to stay under it
 *
 * The analysis is pure computation over the files a pull request touched. No
 * model is called, so there is no cost guard here and nothing to charge: the
 * expensive part of this product is not on this path. That is why the slice
 * needs no queue — and if a correction step is ever added, it will, because
 * then the run is back to being a sum of model calls.
 */

export const runtime = 'nodejs';

function ok(reason: string, extra: Record<string, unknown> = {}) {
  return Response.json({ ok: true, reason, ...extra });
}

export async function POST(request: Request): Promise<Response> {
  const secret = process.env.GITHUB_WEBHOOK_SECRET ?? '';
  if (!secret) {
    /*
     * Fail closed, and say which variable. The same trap this repository has
     * already been caught by: `vercel env add` in a non-interactive shell
     * recorded empty values that `vercel env ls` lists as present, and the only
     * thing that told them apart was a response that named the problem.
     */
    console.error('GITHUB_WEBHOOK_SECRET is not set; refusing the delivery');
    return Response.json(
      { ok: false, reason: 'webhook secret not configured' },
      { status: 503 },
    );
  }

  // Read once, as text. Re-serialising parsed JSON does not round-trip byte for
  // byte, so a signature checked against it fails for honest deliveries.
  const rawBody = await request.text();

  if (
    !verifySignature(
      rawBody,
      request.headers.get('x-hub-signature-256'),
      secret,
    )
  ) {
    return Response.json(
      { ok: false, reason: 'bad signature' },
      { status: 401 },
    );
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return Response.json(
      { ok: false, reason: 'body is not JSON' },
      { status: 400 },
    );
  }

  const decision = decideWebhook(
    request.headers.get('x-github-event'),
    payload,
  );
  if (!decision.act) return ok(decision.reason);

  const config = readGitHubApp();
  if (!config) {
    console.error('No GitHub App credentials; cannot answer the delivery');
    return Response.json(
      { ok: false, reason: 'github app not configured' },
      { status: 503 },
    );
  }

  const app = new App({
    appId: config.appId,
    privateKey: config.privateKey,
  });
  const octokit = await app.getInstallationOctokit(decision.installationId);

  let checkout: string | null = null;
  try {
    const files = await octokit.paginate(octokit.rest.pulls.listFiles, {
      owner: decision.owner,
      repo: decision.repo,
      pull_number: decision.pullNumber,
      per_page: 100,
    });
    const changedFiles = files
      .filter((file) => file.status !== 'removed')
      .map((file) => file.filename);

    const materialised = await materialiseRepository(
      decision.owner,
      decision.repo,
      decision.headSha,
      null,
      decision.installationId,
    );
    checkout = materialised.dir;

    const analysis = analysePullRequest({
      rootDir: materialised.dir,
      changedFiles,
    });

    /*
     * A repository this cannot analyse still gets a check saying so. Returning
     * without writing one would leave the reviewer with silence, and silence on
     * a pull request reads as approval — the failure mode this product exists
     * to remove, reproduced by the thing meant to remove it.
     */
    const report: AuditReport = analysis.report ?? {
      findings: [],
      keysChecked: 0,
      localesChecked: [],
      dynamicCallSites: 0,
      unreferencedSourceKeys: 0,
    };

    const checkRunId = await publishCheck({
      checks: octokit.rest.checks as never,
      owner: decision.owner,
      repo: decision.repo,
      headSha: decision.headSha,
      report,
      skipped: analysis.skipped,
    });

    return ok('analysed', {
      check: CHECK_NAME,
      checkRunId,
      findings: report.findings.length,
      skipped: analysis.skipped,
    });
  } catch (error) {
    /*
     * Logged whole, answered as one sentence, and answered 200.
     *
     * A 5xx makes GitHub retry, and every retry re-downloads the repository to
     * reach the same failure. Whatever broke here — a missing `checks: write`
     * permission being the likeliest — will not be fixed by doing it four more
     * times.
     */
    console.error('i18n webhook analysis failed:', error);
    return ok('analysis failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    await discardCheckout(checkout);
  }
}
