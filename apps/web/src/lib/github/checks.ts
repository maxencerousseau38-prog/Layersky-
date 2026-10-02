import 'server-only';
import type { AuditReport, Finding } from '@localize-infra/eval';

/**
 * The check a reviewer actually reads.
 *
 * ## Idempotence without a table
 *
 * A pull request is pushed to repeatedly, and every push re-delivers the
 * webhook. Creating a check run each time would stack identical checks on one
 * commit until the reviewer stops looking.
 *
 * GitHub already keys check runs by `(name, head_sha)`, so the fix is to ask
 * for existing runs with that name on that SHA and update the first one instead
 * of creating a second. That is why this slice needs no new table, no migration
 * and no bookkeeping of its own — the state lives where the thing being
 * updated already lives.
 *
 * ## The failure is `neutral`, not `failure`, and that is a product decision
 *
 * Nobody has agreed to let this block a merge. A `failure` conclusion goes red
 * and, on a repository with required checks, stops work — on the strength of a
 * hypothesis nobody outside this project has validated. `neutral` shows the
 * same findings, in the same place, and blocks nothing. It can become `failure`
 * the day somebody asks for it, which is the direction that does not require an
 * apology.
 *
 * ## It also carries what the correction did, and that is why
 *
 * The correction used to report itself in the webhook's HTTP response. That
 * response is never read: measured against production on 2026-10-02, GitHub
 * starts the delivery, waits its 10 seconds and gives up — the quota charge
 * alone landed at 9.2s, with the model call after it — so the delivery log
 * stores `context deadline exceeded` where the body should be. Every delivery
 * that corrects was recorded as a 500; the only 200 was the one the webhook
 * declined instantly.
 *
 * So the one place a human reads is this check, and the correction's own
 * reconciliation — asked for, added, left — is appended to it. That costs no
 * queue and no table for the same reason the check itself does not: GitHub keys
 * check runs by `(name, head_sha)`, so the second write updates the first.
 *
 * The verdict does not move. Title and conclusion still describe *this* commit's
 * findings, because the correction's effect only exists on the next one.
 */

export const CHECK_NAME = 'Layersky i18n';

/** Only what this module needs from Octokit, so tests need no real client. */
export interface ChecksApi {
  listForRef(args: {
    owner: string;
    repo: string;
    ref: string;
    check_name: string;
  }): Promise<{ data: { check_runs: { id: number }[] } }>;
  create(args: Record<string, unknown>): Promise<{ data: { id: number } }>;
  update(args: Record<string, unknown>): Promise<{ data: { id: number } }>;
}

export interface CheckOutput {
  title: string;
  summary: string;
  text?: string;
}

/**
 * How many findings are printed before the list is cut.
 *
 * A check body has a size limit and a reader has a smaller one. A pull request
 * that renames a namespace can produce hundreds of findings, and a wall of them
 * communicates less than ten plus a count.
 */
const MAX_LISTED = 20;

function describeFinding(finding: Finding): string {
  const where = finding.locale ? ` — \`${finding.locale}\`` : '';
  return `- **${finding.kind}**${where} ${finding.detail}`;
}

/**
 * What the automatic correction did, in a shape this module can render.
 *
 * A union rather than a bag of optional fields, because "it was not attempted"
 * and "it was attempted and wrote nothing" are different things to read and
 * were previously the same object with different keys filled in.
 */
export type CorrectionReport =
  | { attempted: false; reason: string }
  | {
      attempted: true;
      /** Translations the correction set out to make. */
      requested: number;
      /** Translations written. */
      applied: number;
      /** Every one that was not written, and why. */
      refusals: { locale: string; key: string; reason: string }[];
      /** The corrective pull request, when one was opened. */
      pr: { number: number; url: string } | null;
      /** Why nothing was opened, when nothing was. */
      reason: string | null;
    };

/** Refusals printed before the list is cut. The ceiling is 40, so this is most. */
const MAX_LISTED_REFUSALS = 20;

/**
 * The correction's section of the check.
 *
 * Pure, so the sentence a reviewer reads is pinned by a test rather than by a
 * production run — which is how the last two defects here were found.
 */
export function describeCorrection(correction: CorrectionReport): string {
  const heading = '### Automatic correction';

  if (!correction.attempted) {
    return `${heading}\n\nNot attempted: ${correction.reason}`;
  }

  if (correction.requested === 0) {
    return `${heading}\n\nNothing was translated. ${correction.reason ?? 'No reason was recorded.'}`;
  }

  const lines = [
    heading,
    '',
    `**${correction.requested} asked for · ${correction.applied} added · ${correction.refusals.length} left for a person.**`,
    '',
  ];

  /*
   * The arithmetic, checked where a human can see it. `buildCorrection`
   * guarantees it reconciles; saying so here means a day when it does not is
   * visible on the pull request rather than only in a test — and the words name
   * it as our bug, not the model's.
   */
  if (
    correction.applied + correction.refusals.length !==
    correction.requested
  ) {
    lines.push(
      `⚠️ Those numbers do not add up, which is a defect in Layersky: ${correction.requested} were asked for but only ${correction.applied + correction.refusals.length} are accounted for.`,
      '',
    );
  }

  if (correction.pr) {
    lines.push(
      `A corrective pull request is open: #${correction.pr.number} — ${correction.pr.url}`,
      '',
    );
  } else if (correction.reason) {
    lines.push(`No pull request was opened: ${correction.reason}`, '');
  }

  if (correction.refusals.length > 0) {
    lines.push('Left for a person:', '');
    for (const refusal of correction.refusals.slice(0, MAX_LISTED_REFUSALS)) {
      lines.push(
        `- **${refusal.locale}** — \`${refusal.key}\`: ${refusal.reason}`,
      );
    }
    if (correction.refusals.length > MAX_LISTED_REFUSALS) {
      lines.push(
        `- …and ${correction.refusals.length - MAX_LISTED_REFUSALS} more.`,
      );
    }
  }

  return lines.join('\n').trimEnd();
}

/**
 * Turn a report into the words on the check.
 *
 * Pure, and separate from the API call, because this is the part worth
 * asserting: a test can pin the sentence a reviewer reads without a network.
 */
export function buildCheckOutput(
  report: AuditReport,
  skipped: string | null = null,
  correction: CorrectionReport | null = null,
): CheckOutput {
  /*
   * Appended in every branch, including the skipped and the clean ones. A
   * correction that ran must be reported wherever the check ends up, and
   * "except on that path" is how the last hole was shaped.
   */
  const withCorrection = (output: CheckOutput): CheckOutput =>
    correction
      ? {
          ...output,
          summary: `${output.summary}\n\n${describeCorrection(correction)}`,
        }
      : output;

  /*
   * A repository this could not analyse gets a check that says why, not a
   * green one. "No problems found" over a repository nothing was read from is
   * the exact failure this product exists to remove — silence that reads as
   * approval — and producing it here would be the tool committing the fault it
   * is selling against.
   */
  if (skipped) {
    return withCorrection({ title: 'Not analysed', summary: skipped });
  }

  const { findings } = report;
  const locales = report.localesChecked;

  const scope =
    report.keysChecked === 0
      ? 'No translation keys were touched by this pull request.'
      : `Checked ${report.keysChecked} key${report.keysChecked === 1 ? '' : 's'} against ${locales.length} language${locales.length === 1 ? '' : 's'} (${locales.join(', ') || 'none'}).`;

  /*
   * Stated every time, including on a pass. A check that says "all good" while
   * having silently skipped the dynamic call sites is claiming more than it
   * looked at — and the number is exactly the denominator a reader needs to
   * judge how much the green is worth.
   */
  const limits =
    report.dynamicCallSites > 0
      ? ` ${report.dynamicCallSites} call site${report.dynamicCallSites === 1 ? ' was' : 's were'} skipped because the key is computed at runtime and cannot be read statically.`
      : '';

  if (findings.length === 0) {
    return withCorrection({
      title: 'No i18n problems found',
      summary: `${scope}${limits}`,
    });
  }

  const byKind = new Map<string, number>();
  for (const finding of findings) {
    byKind.set(finding.kind, (byKind.get(finding.kind) ?? 0) + 1);
  }
  const breakdown = [...byKind.entries()]
    .map(([kind, n]) => `${n} ${kind}`)
    .join(', ');

  const listed = findings.slice(0, MAX_LISTED).map(describeFinding);
  const remainder =
    findings.length > MAX_LISTED
      ? `\n\n…and ${findings.length - MAX_LISTED} more.`
      : '';

  return withCorrection({
    title: `${findings.length} i18n problem${findings.length === 1 ? '' : 's'}`,
    summary: `${scope}${limits}\n\n**Found:** ${breakdown}.`,
    text: `${listed.join('\n')}${remainder}`,
  });
}

/**
 * The conclusion, as one exported rule.
 *
 * `neutral` for both a skip and a finding, `success` only for a clean audit
 * that actually ran. A skip is not a pass and must not be coloured like one.
 *
 * Exported because a second reader needs it: the row `lib/i18n/record-check.ts`
 * stores has to carry the same verdict the commit shows, and recomputing
 * `skipped || findings.length > 0` there would be the same rule written twice,
 * free to drift the day `failure` becomes allowed.
 */
export function checkConclusion(
  report: AuditReport,
  skipped: string | null,
): 'success' | 'neutral' {
  return skipped || report.findings.length > 0 ? 'neutral' : 'success';
}

export interface PublishArgs {
  checks: ChecksApi;
  owner: string;
  repo: string;
  headSha: string;
  report: AuditReport;
  /** Why no audit ran, when none did. The check says so rather than passing. */
  skipped?: string | null;
  /**
   * What the correction did, appended to the check's summary.
   *
   * The second call of a delivery passes this. Reusing this function rather
   * than writing an updater means one place composes the output and one place
   * decides create-or-update — the alternative is two bodies free to disagree
   * about what a reviewer sees.
   */
  correction?: CorrectionReport | null;
  /**
   * The run to update, when the caller already knows it.
   *
   * Not an optimisation. Without it the second call lists again, and the
   * fallback for a failed list is to *create* — which on the second call would
   * put a duplicate check on the commit instead of updating the first.
   */
  checkRunId?: number | null;
}

/**
 * Create the check, or update the one already on this commit.
 *
 * Returns the check run id so a caller can say which one it wrote, which is the
 * only way to tell an update from a duplicate after the fact.
 */
export async function publishCheck(args: PublishArgs): Promise<number> {
  const output = buildCheckOutput(
    args.report,
    args.skipped ?? null,
    args.correction ?? null,
  );
  const conclusion = checkConclusion(args.report, args.skipped ?? null);

  const common = {
    owner: args.owner,
    repo: args.repo,
    name: CHECK_NAME,
    head_sha: args.headSha,
    status: 'completed' as const,
    conclusion,
    completed_at: new Date().toISOString(),
    output,
  };

  /*
   * A failure to list is treated as "none exist", so the check is created
   * rather than skipped. A duplicate check is a cosmetic problem; no check at
   * all is the reviewer getting silence and reading it as a pass.
   */
  let existingId: number | null = args.checkRunId ?? null;
  if (existingId === null) {
    try {
      const existing = await args.checks.listForRef({
        owner: args.owner,
        repo: args.repo,
        ref: args.headSha,
        check_name: CHECK_NAME,
      });
      existingId = existing.data.check_runs[0]?.id ?? null;
    } catch {
      existingId = null;
    }
  }

  if (existingId !== null) {
    const updated = await args.checks.update({
      ...common,
      check_run_id: existingId,
    });
    return updated.data.id;
  }

  const created = await args.checks.create(common);
  return created.data.id;
}

/**
 * Tell the reviewer the analysis broke, on the check.
 *
 * This replaces the 200-with-a-reason the webhook used to return. That reply at
 * least reached GitHub's delivery log; since the handler now answers before it
 * does any work, a failure would otherwise be silence on the pull request — and
 * silence reads as approval, the fault this product sells against.
 *
 * `skipped` is the right channel and needs no new rendering: it comes out as
 * "Not analysed" with a `neutral` conclusion, which is exactly what a failed
 * analysis is. Never `success`.
 *
 * ## It refuses to overwrite a check that already said something
 *
 * `alreadyPublished` is the whole point of this function existing rather than a
 * bare call to `publishCheck`. If the failure happened *after* the findings were
 * published — a correction that threw, say — then writing here would replace
 * "6 i18n problems" with "Not analysed" and destroy the one thing the reviewer
 * had. A later failure is a worse report than the earlier success, so it is not
 * written at all; the log keeps it.
 *
 * Returns what it did, so a caller — and a test — can tell the three outcomes
 * apart instead of inferring them.
 */
export async function publishAnalysisFailure(args: {
  /** Null when the client could not even be built. Then only the log has it. */
  checks: ChecksApi | null;
  owner: string;
  repo: string;
  headSha: string;
  error: unknown;
  /** True once a real check exists for this commit. */
  alreadyPublished: boolean;
}): Promise<'written' | 'skipped' | 'failed'> {
  if (args.alreadyPublished || !args.checks) return 'skipped';

  const detail =
    args.error instanceof Error ? args.error.message : String(args.error);

  try {
    await publishCheck({
      checks: args.checks,
      owner: args.owner,
      repo: args.repo,
      headSha: args.headSha,
      report: {
        findings: [],
        keysChecked: 0,
        localesChecked: [],
        dynamicCallSites: 0,
        unreferencedSourceKeys: 0,
      },
      // Truncated, because a stack-carrying provider error can be long and the
      // check body has a limit. Verbatim up to that point (DESIGN.md §8).
      skipped: `Layersky could not analyse this pull request: ${detail.slice(0, 500)}`,
    });
    return 'written';
  } catch (secondary) {
    /*
     * Best-effort by necessity: if GitHub is what broke, there is nothing to
     * write with. Logged rather than rethrown — this runs inside a catch whose
     * request is already closed.
     */
    console.error(
      'the analysis-failure check could not be written either:',
      secondary,
    );
    return 'failed';
  }
}
