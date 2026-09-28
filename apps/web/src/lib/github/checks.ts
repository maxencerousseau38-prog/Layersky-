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
 * Turn a report into the words on the check.
 *
 * Pure, and separate from the API call, because this is the part worth
 * asserting: a test can pin the sentence a reviewer reads without a network.
 */
export function buildCheckOutput(
  report: AuditReport,
  skipped: string | null = null,
): CheckOutput {
  /*
   * A repository this could not analyse gets a check that says why, not a
   * green one. "No problems found" over a repository nothing was read from is
   * the exact failure this product exists to remove — silence that reads as
   * approval — and producing it here would be the tool committing the fault it
   * is selling against.
   */
  if (skipped) {
    return { title: 'Not analysed', summary: skipped };
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
    return {
      title: 'No i18n problems found',
      summary: `${scope}${limits}`,
    };
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

  return {
    title: `${findings.length} i18n problem${findings.length === 1 ? '' : 's'}`,
    summary: `${scope}${limits}\n\n**Found:** ${breakdown}.`,
    text: `${listed.join('\n')}${remainder}`,
  };
}

export interface PublishArgs {
  checks: ChecksApi;
  owner: string;
  repo: string;
  headSha: string;
  report: AuditReport;
  /** Why no audit ran, when none did. The check says so rather than passing. */
  skipped?: string | null;
}

/**
 * Create the check, or update the one already on this commit.
 *
 * Returns the check run id so a caller can say which one it wrote, which is the
 * only way to tell an update from a duplicate after the fact.
 */
export async function publishCheck(args: PublishArgs): Promise<number> {
  const output = buildCheckOutput(args.report, args.skipped ?? null);
  /*
   * `neutral` for both a skip and a finding, `success` only for a clean audit
   * that actually ran. A skip is not a pass and must not be coloured like one.
   */
  const conclusion =
    args.skipped || args.report.findings.length > 0 ? 'neutral' : 'success';

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
  let existingId: number | null = null;
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
