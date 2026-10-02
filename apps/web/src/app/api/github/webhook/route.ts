import {
  CHECK_NAME,
  type ChecksApi,
  type CorrectionReport,
  buildCheckOutput,
  checkConclusion,
  publishAnalysisFailure,
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
import { describeFindings, recordCheck } from '@/lib/i18n/record-check';
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
 * ## Two timeouts, not one, and the shorter one decides the shape of this file
 *
 * Vercel's is 300 seconds. **GitHub's is ten**, for the delivery, and it is the
 * one that bit — twice, because the first fix was aimed at the wrong half.
 *
 * Moving the *correction* into `after` was the first attempt. The delivery still
 * died at **10.003 s**, GitHub's limit to the millisecond, because the analysis
 * exceeds it on its own: `materialiseRepository` downloads and unpacks a
 * repository tarball before anything is read. The quota charge moved from 9.2 s
 * to 11.5 s, which is to say from *just* too late to plainly too late. Six
 * consecutive deliveries were recorded as 500 `context deadline exceeded`.
 *
 * So the split is now where the network begins. Everything before the response
 * is an env read, one HMAC and one `JSON.parse`; everything that touches GitHub
 * is in `handleDelivery`, after. GitHub gets its 200 in milliseconds, which
 * matters beyond tidiness: it gave up after one attempt each time, so there was
 * no retry storm, but a hook that accumulates failures gets disabled.
 *
 * Still no queue, and it should not be mistaken for one: the work happens in
 * this same invocation, still bounded by `MAX_CORRECTION_UNITS` before any of
 * it starts, still lost if the function dies.
 *
 * **What it costs** is the thing to keep in view. Nothing after the response
 * can be reported by returning, so a broken delivery can no longer answer with
 * a sentence somebody will read in the delivery log. Two things replace it, and
 * neither is free: every failure is logged with the pull request it belongs to,
 * and every failure that can still reach GitHub is written onto the check as
 * "Not analysed". A failure that cannot reach GitHub leaves only the log.
 *
 * The ordering inside still carries the rest. The check is published *before*
 * the correction is attempted, so a correction that dies leaves the reviewer
 * told what is wrong — the finding is the product's promise, the fix is the
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

  /*
   * The answer, now, before any network call.
   *
   * Everything above is env reads, one HMAC and one `JSON.parse` — microseconds.
   * Everything below needs GitHub, and `materialiseRepository` alone downloads
   * and unpacks a repository tarball.
   *
   * Measured on 2026-10-02, twice. Moving only the correction into `after` was
   * not enough: the delivery still died at **10.003 s**, GitHub's limit to the
   * millisecond, because the analysis exceeds it on its own. The quota charge
   * moved from 9.2 s to 11.5 s, which is to say past the point where anybody
   * was still listening.
   *
   * So the delivery is acknowledged here and the work happens after. Six
   * consecutive deliveries were recorded as 500 `context deadline exceeded`
   * before this, and a hook that accumulates failures gets disabled by GitHub.
   */
  after(() => handleDelivery(decision, config));

  return ok('accepted', {
    /*
     * What was accepted, not what was found — nothing has been looked at yet.
     * Claiming a finding count here would be the false success this product
     * exists to remove, in its own webhook reply.
     */
    pullRequest: decision.pullNumber,
    headSha: decision.headSha,
    check: CHECK_NAME,
  });
}

/** An audit that never ran. Reported as "not analysed", never as a pass. */
const NO_REPORT: AuditReport = {
  findings: [],
  keysChecked: 0,
  localesChecked: [],
  dynamicCallSites: 0,
  unreferencedSourceKeys: 0,
};

/**
 * Everything that needs the network: analyse, publish, correct, clean up.
 *
 * Runs after the response, so **nothing it does can be reported by returning**.
 * That is the trade this shape accepts, and it is why the two things below
 * exist: every failure is logged with enough context to find the pull request
 * it belongs to, and every failure that can still reach GitHub is written onto
 * the check.
 *
 * It never throws. A rejection here would surface as an unhandled one in a
 * function whose request is already closed, which is the least useful place a
 * stack trace can land.
 */
async function handleDelivery(
  decision: Extract<ReturnType<typeof decideWebhook>, { act: true }>,
  config: NonNullable<ReturnType<typeof readGitHubApp>>,
): Promise<void> {
  const where = `${decision.owner}/${decision.repo}#${decision.pullNumber} (${decision.headSha})`;
  let checkout: string | null = null;
  let checks: ChecksApi | null = null;
  /*
   * Flips the moment a check carrying real findings exists. After that a
   * failure must not be written over it — see `publishAnalysisFailure`.
   */
  let published = false;

  try {
    const app = new App({
      appId: config.appId,
      privateKey: config.privateKey,
    });
    const octokit = await app.getInstallationOctokit(decision.installationId);
    /*
     * Kept so a failure below still has something to write with. Cast because
     * Octokit's generated signatures are narrower than `ChecksApi`, which is
     * deliberately the three calls this product makes and nothing else — the
     * same cast the `publishCheck` call sites make.
     */
    checks = octokit.rest.checks as unknown as ChecksApi;

    /*
     * Who this delivery belongs to, asked once.
     *
     * It used to be resolved inside `correct()`, which meant a repository whose
     * check found nothing — or whose correction never ran — was never
     * attributed to a workspace and so never indexed. The dashboard would then
     * show only the deliveries that happened to spend money, which is the
     * wrong half.
     */
    const workspace = await resolveInstallationWorkspace(
      decision.installationId,
    );

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
     * sites and creating a second code path that could disagree with the first.
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
    const report: AuditReport = analysis.report ?? NO_REPORT;

    const checkRunId = await publishCheck({
      checks: octokit.rest.checks as never,
      owner: decision.owner,
      repo: decision.repo,
      headSha: decision.headSha,
      report,
      skipped: analysis.skipped,
    });
    published = true;

    /*
     * Indexed for the product, after the check and never before it.
     *
     * `checkConclusion` rather than a second `findings.length > 0` test: the
     * row has to carry the verdict the commit shows, and two copies of that
     * rule would drift the day `failure` becomes allowed.
     */
    if (workspace.organizationId) {
      const output = buildCheckOutput(report, analysis.skipped);
      await recordCheck({
        organizationId: workspace.organizationId,
        owner: decision.owner,
        repo: decision.repo,
        pullNumber: decision.pullNumber,
        headSha: decision.headSha,
        conclusion: checkConclusion(report, analysis.skipped),
        title: output.title,
        summary: output.summary,
        // Null, not zero, when nothing was analysed. "Analysed and found
        // nothing" and "could not analyse" must not collapse into one number.
        keysChecked: analysis.skipped ? null : report.keysChecked,
        localesChecked: report.localesChecked,
        skippedReason: analysis.skipped,
        checkRunId,
        checkRunUrl: `https://github.com/${decision.owner}/${decision.repo}/runs/${checkRunId}`,
        findings: analysis.audited
          ? describeFindings({
              report,
              catalogues: analysis.audited.catalogues,
              sourceLocale: SOURCE_LOCALE,
            })
          : [],
        correction: null,
      });
    }

    /*
     * The correction, after the check and never instead of it. The check is the
     * product's promise and costs nothing, so it is published before anything
     * that can fail or run long; a correction that dies leaves the reviewer
     * still told what is wrong.
     */
    const audited = analysis.audited;
    if (!audited || report.findings.length === 0) return;

    const correction = await correct({
      octokit,
      decision,
      report,
      audited,
      checkoutDir: materialised.dir,
      workspace,
    });

    /*
     * The same `publishCheck`, with the run id it already returned. GitHub keys
     * check runs by `(name, head_sha)`, so this updates the one above rather
     * than stacking a second — and passing the id means a failed lookup cannot
     * fall back to creating a duplicate.
     *
     * This is the only surface the correction has. A total refusal opens no
     * pull request, so without this write the reason exists nowhere: that is
     * exactly what happened on 2026-10-02 at 14:37 UTC.
     */
    await publishCheck({
      checks: octokit.rest.checks as never,
      owner: decision.owner,
      repo: decision.repo,
      headSha: decision.headSha,
      report,
      skipped: analysis.skipped,
      checkRunId,
      correction,
    });

    /*
     * The correction, indexed. A second call rather than one write at the end,
     * because the findings must be stored even when the correction throws or
     * never runs — and `record_i18n_check` coalesces, so this call updates the
     * correction columns without touching the findings the first one stored.
     */
    if (workspace.organizationId) {
      const output = buildCheckOutput(report, analysis.skipped, correction);
      await recordCheck({
        organizationId: workspace.organizationId,
        owner: decision.owner,
        repo: decision.repo,
        pullNumber: decision.pullNumber,
        headSha: decision.headSha,
        conclusion: checkConclusion(report, analysis.skipped),
        title: output.title,
        summary: output.summary,
        keysChecked: analysis.skipped ? null : report.keysChecked,
        localesChecked: report.localesChecked,
        skippedReason: analysis.skipped,
        checkRunId,
        checkRunUrl: `https://github.com/${decision.owner}/${decision.repo}/runs/${checkRunId}`,
        findings: null,
        correction: correction.attempted
          ? {
              requested: correction.requested,
              applied: correction.applied,
              refused: correction.refusals.length,
              note: correction.reason,
              prNumber: correction.pr?.number ?? null,
              prUrl: correction.pr?.url ?? null,
            }
          : {
              requested: 0,
              applied: 0,
              refused: 0,
              note: correction.reason,
              prNumber: null,
              prUrl: null,
            },
      });
    }
  } catch (error) {
    /*
     * Logged with the pull request it belongs to, because the response that
     * used to carry this is gone. One line, greppable, and the whole error.
     */
    console.error(`i18n delivery failed for ${where}:`, error);
    await publishAnalysisFailure({
      checks,
      owner: decision.owner,
      repo: decision.repo,
      headSha: decision.headSha,
      error,
      alreadyPublished: published,
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
  /** Resolved once by the caller, so a delivery does one lookup, not two. */
  workspace: Awaited<ReturnType<typeof resolveInstallationWorkspace>>;
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
   * Who pays. Resolved by the caller now, because the index needs it too and a
   * delivery should do that lookup once — see `handleDelivery`.
   *
   * Unresolvable still means no correction: spending on behalf of a workspace
   * that cannot be identified is spending nobody is accountable for, which is
   * the defect #133 closed.
   */
  const workspace = args.workspace;
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
