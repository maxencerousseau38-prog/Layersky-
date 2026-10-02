import {
  CHECK_NAME,
  type CorrectionReport,
  publishCheck,
} from '@/lib/github/checks';
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
import { chargeWorkspace } from '@/lib/quota/charge';
import { resolveInstallationWorkspace } from '@/lib/quota/installation';
import { loadI18nextCatalogues } from '@localize-infra/core';
import type { AuditReport } from '@localize-infra/eval';
import { after } from 'next/server';
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
 * ## Two timeouts, not one, and this paragraph used to know about only the first
 *
 * Vercel's is 300 seconds. **GitHub's is ten**, for the delivery, and that is
 * the one that bit. The analysis is pure computation and fits; the correction
 * calls a model and does not. Measured on 2026-10-02: the quota charge landed
 * at 9.2s with the model call after it, so every delivery that corrected was
 * recorded as `context deadline exceeded` — a 500 in the delivery log, and the
 * response body, which carried the correction's report, discarded unread.
 * GitHub gave up after one attempt, so no retry storm; but a hook that
 * accumulates failures gets disabled.
 *
 * So the response goes out as soon as the check is published, and the
 * correction runs in `after`. Still no queue: the work happens in this same
 * invocation, still bounded by `MAX_CORRECTION_UNITS` before any of it starts,
 * still lost if the function dies. What changed is who hears about it — the
 * correction now reports itself onto the check run, the one surface a human
 * reads, instead of into a response nobody receives.
 *
 * The ordering still carries the rest. The check is published *before* the
 * correction is attempted, so a correction that dies leaves the reviewer told
 * what is wrong — the finding is the product's promise, the fix is the
 * convenience.
 *
 * ## And the ceiling is no longer the only thing bounding the spend
 *
 * It was, and that was a hole: `MAX_CORRECTION_UNITS` bounds one delivery and
 * bounds nothing across a day, so a repository pushed to repeatedly could
 * spend without limit on the operator's account. The delivery's installation
 * now resolves to a workspace and that workspace is charged through the same
 * `consume_api_quota` the browser and the CLI go through, before any model
 * call. See `correct()` below.
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
     * The correction, after the check, after the response, and never instead
     * of the check.
     *
     * Ordering matters twice over. The check is the product's promise and costs
     * nothing, so it is published before anything that can fail. And the
     * response is returned before the correction starts, because GitHub waits
     * ten seconds and no longer: measured on 2026-10-02, the quota charge alone
     * landed at 9.2s with the model call after it, so every delivery that
     * corrected was recorded as `context deadline exceeded` — a 500 in the
     * delivery log, and the body, which carried the correction's own report,
     * discarded unread. Enough of those and GitHub disables the hook.
     *
     * `after` runs the rest once the response is sent. It is not a queue and
     * does not pretend to be one: the work still happens inside this
     * invocation, still bounded by `MAX_CORRECTION_UNITS`, still lost if the
     * function dies. What changes is that GitHub gets its answer in time, and
     * the correction reports itself on the check instead of into a response
     * nobody receives.
     */
    const audited = analysis.audited;
    const correcting = Boolean(audited) && report.findings.length > 0;

    if (audited && correcting) {
      const checkoutDir = materialised.dir;
      const skipped = analysis.skipped;

      after(async () => {
        try {
          const correction = await correct({
            octokit,
            decision,
            report,
            audited,
            checkoutDir,
          });

          /*
           * The same `publishCheck`, with the run id it already returned.
           * GitHub keys check runs by `(name, head_sha)`, so this updates the
           * one above rather than stacking a second — and passing the id means
           * a failed lookup cannot fall back to creating a duplicate.
           */
          await publishCheck({
            checks: octokit.rest.checks as never,
            owner: decision.owner,
            repo: decision.repo,
            headSha: decision.headSha,
            report,
            skipped,
            checkRunId,
            correction,
          });
        } catch (error) {
          /*
           * Nothing downstream will see this: the response is long gone and
           * GitHub's delivery log holds a 200. The log line is the only record,
           * so it is logged whole.
           */
          console.error('i18n correction (after response) failed:', error);
        } finally {
          await discardCheckout(checkoutDir);
        }
      });

      /*
       * Ownership of the checkout moves to the task above, so the handler's
       * `finally` must not delete it. Assigned only once `after` has accepted
       * the callback: the other order would leak the directory if it threw.
       */
      checkout = null;
    }

    return ok('analysed', {
      check: CHECK_NAME,
      checkRunId,
      findings: report.findings.length,
      skipped: analysis.skipped,
      catalogueFilesCompared: base.touched.length,
      /*
       * Whether a correction is running, not what it did — it has not started
       * yet. What it did goes on the check.
       */
      correcting,
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
 *
 * ## Who pays
 *
 * Nothing here spends until the delivery's installation has been resolved to a
 * workspace and that workspace has been charged. The check above is published
 * either way — a repository whose workspace cannot be found or cannot afford
 * the fix is still told what is wrong with it, because the finding is the
 * promise and the fix is the convenience.
 */
async function correct(args: {
  octokit: Awaited<ReturnType<App['getInstallationOctokit']>>;
  decision: Extract<ReturnType<typeof decideWebhook>, { act: true }>;
  report: AuditReport;
  audited: NonNullable<
    Awaited<ReturnType<typeof analysePullRequest>>['audited']
  >;
  checkoutDir: string;
}): Promise<CorrectionReport> {
  const apiUrl = process.env.LOCALIZE_API_URL;
  const apiToken = process.env.LOCALIZE_API_TOKEN;
  if (!apiUrl || !apiToken) {
    return {
      attempted: false,
      reason: 'the translation API is not configured on this deployment',
    };
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

  /*
   * Who pays, asked before anything is planned.
   *
   * A delivery names an installation and `organization_github_installations`
   * turns that into a workspace — the row has existed since `20260817000600`
   * and nothing on this path was reading it. Unresolvable means no correction:
   * spending on behalf of a workspace that cannot be identified is spending
   * nobody is accountable for, which is the whole defect this closes.
   */
  const workspace = await resolveInstallationWorkspace(
    args.decision.installationId,
  );
  /*
   * `=== null`, not `!`. The union discriminates on `organizationId` being a
   * string or null, and a truthiness test cannot rule out the empty string — so
   * `!workspace.organizationId` leaves `reason` as `string | null` and the
   * refusal loses its sentence. The compiler said so.
   */
  if (workspace.organizationId === null) {
    return { attempted: false, reason: workspace.reason };
  }
  const organizationId = workspace.organizationId;

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
      /*
       * Both acts of the correction, charged here and nowhere else.
       *
       * The pull request goes first although it is opened last. By the time
       * this runs the plan is non-empty, so a pull request is genuinely
       * intended, and buying the cheap half first means the expensive half is
       * never bought for a correction the ceiling will not let us deliver.
       * Charging it any earlier would spend a unit on every delivery that
       * plans nothing — the common case, since a `placeholder-mismatch` is
       * left for a person — and GitHub redelivers on every push.
       *
       * Same routes, same units and same counters as the browser: one
       * workspace has one ceiling however it spends.
       */
      charge: async (plannedUnits) => {
        await chargeWorkspace({ organizationId, route: 'open_pr', units: 1 });
        await chargeWorkspace({
          organizationId,
          route: 'translate',
          units: plannedUnits,
        });
      },
    });

    if (outcome.refusal) {
      /*
       * Nothing to open, so nothing is opened — an empty corrective pull
       * request is the defect that produced five of them on the fixture in two
       * days. The reasons go on the check instead, which is the only surface a
       * total refusal has.
       */
      return {
        attempted: true,
        requested: outcome.requested,
        applied: 0,
        refusals: describeRefusals(outcome.rejected),
        pr: null,
        reason: outcome.refusal,
      };
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
      /*
       * The title says "5 of 6" when it is 5 of 6. The first production cycle
       * titled a partial correction "add 5 missing translations" while six had
       * been asked for, so the one number a reviewer sees without opening
       * anything was the one that hid the gap.
       */
      title:
        outcome.rejected.length > 0
          ? `i18n: add ${outcome.applied.length} of ${outcome.requested} missing translations`
          : `i18n: add ${outcome.applied.length} missing translation${outcome.applied.length === 1 ? '' : 's'}`,
      body: correctionBody({
        outcome,
        sourceLocale: SOURCE_LOCALE,
        pullNumber: args.decision.pullNumber,
      }),
      files: outcome.files,
    });

    return {
      attempted: true,
      requested: outcome.requested,
      applied: outcome.applied.length,
      refusals: describeRefusals(outcome.rejected),
      pr: opened.opened ? { number: opened.prNumber, url: opened.prUrl } : null,
      reason: opened.opened ? null : opened.reason,
    };
  } catch (error) {
    /*
     * Logged whole, and reported on the check as a correction that was
     * attempted and produced nothing. `requested: 0` because the count is not
     * knowable from here — the throw may have come before the plan existed.
     */
    console.error('i18n correction failed:', error);
    return {
      attempted: true,
      requested: 0,
      applied: 0,
      refusals: [],
      pr: null,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

/** The rejected units, flattened to what the check and the logs print. */
function describeRefusals(
  rejected: readonly {
    unit: { locale: string; key: string };
    reason: string;
  }[],
): { locale: string; key: string; reason: string }[] {
  return rejected.map((entry) => ({
    locale: entry.unit.locale,
    key: entry.unit.key,
    reason: entry.reason,
  }));
}
