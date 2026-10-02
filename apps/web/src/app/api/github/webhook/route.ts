import { CHECK_NAME, publishCheck } from '@/lib/github/checks';
import { readGitHubApp } from '@/lib/github/config';
import { materialiseRepository } from '@/lib/github/materialise';
import { decideWebhook, verifySignature } from '@/lib/github/webhook';
import { analysePullRequest, discardCheckout } from '@/lib/i18n/analyse';
import { readBaseCatalogues } from '@/lib/i18n/base-catalogue';
import { correctableDirectory } from '@/lib/i18n/correct';
import { openCorrectivePr, translateBatch } from '@/lib/i18n/correct-github';
import {
  buildCorrection,
  checkoutReader,
  correctionBody,
} from '@/lib/i18n/correct-run';
import { loadI18nextCatalogues } from '@localize-infra/core';
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
 * The analysis is pure computation over the files a pull request touched, and
 * that half still calls no model.
 *
 * **The correction below does**, which this paragraph used to say would need a
 * queue. It does not have one, and the reason is a ceiling instead:
 * `planCorrection` refuses past `MAX_CORRECTION_UNITS`, so the work a single
 * delivery can take on is bounded before any of it starts. A bulk import is
 * refused with a sentence rather than begun and lost to a timeout.
 *
 * The ordering carries the rest. The check is published *before* the
 * correction is attempted, so a correction that times out still leaves the
 * reviewer told what is wrong — the finding is the product's promise, the fix
 * is the convenience.
 */

export const runtime = 'nodejs';

/*
 * The locale treated as the source of truth. Named here rather than read from
 * the repository's i18next config, which lives in code this does not execute —
 * inferring it would be a guess dressed as a fact, and guessing wrong is
 * visible immediately because every key reports as missing from the source.
 */
const SOURCE_LOCALE = 'en';

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

    /*
     * Where the catalogues are, asked once, so the base comparison recognises
     * the same files the audit will read. The load is repeated inside
     * `analysePullRequest` — a handful of small JSON files from a temporary
     * directory — rather than threading a pre-loaded value through two call
     * sites and creating a second code path that could disagree with the
     * first.
     */
    const located = loadI18nextCatalogues(materialised.dir);
    const base =
      located.layout && located.dir
        ? await readBaseCatalogues({
            fetchFile: async (path, ref) => {
              const response = await octokit.rest.repos.getContent({
                owner: decision.owner,
                repo: decision.repo,
                path,
                ref,
              });
              const data = response.data as { content?: string };
              // A file absent on the base answers 404 and throws, which the
              // caller treats as "no base version" — correct, because every
              // key in a newly added catalogue is new.
              return data.content
                ? Buffer.from(data.content, 'base64').toString('utf-8')
                : null;
            },
            changedFiles,
            cataloguesDir: located.dir,
            layout: located.layout,
            baseSha: decision.baseSha,
          })
        : { catalogues: null, touched: [] };

    const analysis = analysePullRequest({
      rootDir: materialised.dir,
      changedFiles,
      sourceLocale: SOURCE_LOCALE,
      baseCatalogues: base.catalogues,
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

    /*
     * The correction, after the check and never instead of it.
     *
     * Ordering matters: the check is the product's promise and costs nothing,
     * so it is published before anything that can fail or time out. A
     * correction that dies half-way leaves a pull request that has still been
     * told what is wrong with it.
     */
    let correction: Record<string, unknown> = { attempted: false };
    if (analysis.audited && report.findings.length > 0) {
      correction = await correct({
        octokit,
        decision,
        report,
        audited: analysis.audited,
        checkoutDir: materialised.dir,
      });
    }

    return ok('analysed', {
      check: CHECK_NAME,
      checkRunId,
      findings: report.findings.length,
      skipped: analysis.skipped,
      catalogueFilesCompared: base.touched.length,
      correction,
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

/**
 * Translate what is missing and open a pull request with it.
 *
 * Split out of the handler so the handler stays readable as a sequence —
 * verify, decide, analyse, check, correct — and so every failure in here is
 * caught in one place. A correction that throws must never turn a published
 * check into a 500: the reviewer has already been told what is wrong, and the
 * fix not arriving is a smaller problem than the finding disappearing.
 */
async function correct(args: {
  octokit: Awaited<ReturnType<App['getInstallationOctokit']>>;
  decision: Extract<ReturnType<typeof decideWebhook>, { act: true }>;
  report: AuditReport;
  audited: NonNullable<
    Awaited<ReturnType<typeof analysePullRequest>>['audited']
  >;
  checkoutDir: string;
}): Promise<Record<string, unknown>> {
  const apiUrl = process.env.LOCALIZE_API_URL;
  const apiToken = process.env.LOCALIZE_API_TOKEN;
  if (!apiUrl || !apiToken) {
    return { attempted: false, reason: 'translation API not configured' };
  }

  if (!correctableDirectory(args.audited.cataloguesDir)) {
    /*
     * Analysed but not correctable, and said rather than attempted.
     * `/v1/open-pr` only accepts paths under `locales/`, while the loader also
     * finds catalogues in `public/locales` and `src/locales`. Discovering that
     * as a 400 would mean the translations had already been paid for.
     */
    return {
      attempted: false,
      reason: `catalogues live in \`${args.audited.cataloguesDir}\`; corrections can only be written under \`locales/\``,
    };
  }

  try {
    const outcome = await buildCorrection({
      report: args.report,
      catalogues: args.audited.catalogues,
      sourceLocale: SOURCE_LOCALE,
      usedKeys: args.audited.usedKeys,
      dynamicCallSites: args.audited.dynamicCallSites,
      cataloguesDir: args.audited.cataloguesDir,
      layout: args.audited.layout,
      readSource: checkoutReader(args.checkoutDir),
      translate: translateBatch({ apiUrl, apiToken }),
    });

    if (outcome.refusal) {
      return { attempted: true, opened: false, reason: outcome.refusal };
    }

    const opened = await openCorrectivePr({
      apiUrl,
      apiToken,
      owner: args.decision.owner,
      repo: args.decision.repo,
      // Onto the pull request's own head branch, not its base. Merging the
      // correction updates that branch, which fires `synchronize` on the
      // original pull request and re-runs the check that asked for it. The
      // cycle closes itself rather than needing a second trigger.
      baseBranch: args.decision.headRef,
      installationId: args.decision.installationId,
      title: `i18n: add ${outcome.applied.length} missing translation${outcome.applied.length === 1 ? '' : 's'}`,
      body: correctionBody({
        outcome,
        sourceLocale: SOURCE_LOCALE,
        pullNumber: args.decision.pullNumber,
      }),
      files: outcome.files,
    });

    return {
      attempted: true,
      applied: outcome.applied.length,
      rejected: outcome.rejected.length,
      leftAlone: outcome.leftAlone,
      ...opened,
    };
  } catch (error) {
    console.error('i18n correction failed:', error);
    return {
      attempted: true,
      opened: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}
