import 'server-only';
import { planCorrection } from '@/lib/i18n/correct';
import { createAdminClient, readServiceRoleKey } from '@/lib/supabase/admin';
import type { AuditReport } from '@localize-infra/eval';

/**
 * Writing the check into Postgres so a person can read it in the product.
 *
 * The guardrail has published GitHub Checks since #124 and opened corrective
 * pull requests since #132, and `apps/web` showed none of it: everything in the
 * dashboard was still the legacy extraction pipeline. This is the index that
 * closes that — the authority stays the check run on the commit, and every row
 * links back to it.
 *
 * ## Why it fails open, when `chargeWorkspace` fails closed
 *
 * They protect different things. The charge protects money, so a check that
 * could not run must stop the work. This protects a *listing*: if the write
 * fails, the reviewer still has the GitHub Check, the corrective pull request
 * and the delivery — everything that matters already happened. Failing closed
 * here would mean a database hiccup suppresses a check that was published
 * successfully, which trades a real product behaviour for a row.
 *
 * So every path returns rather than throws, and logs what it swallowed.
 */

/** Which findings the correction may act on, and why not when it may not. */
export interface RecordableFinding {
  kind: string;
  key: string;
  locale: string | null;
  detail: string;
  correctable: boolean;
  refusalReason: string | null;
}

/**
 * Split a report into correctable and not, using the planner itself.
 *
 * `planCorrection` is the authority on what is safe to correct — only
 * `missing-translation`, and only when the source locale actually defines the
 * key. Re-deciding that here with a `kind === 'missing-translation'` test would
 * be a second rule free to disagree with the first, and the disagreement would
 * surface as a dashboard promising a fix the correction then refuses.
 *
 * Calling the same pure function with the same inputs is not duplication. It is
 * the only way to label a finding without inventing a rule, and it works on the
 * paths where no correction is attempted at all — an unconfigured API, an
 * unresolvable workspace — where there is no outcome to read the answer from.
 */
export function describeFindings(args: {
  report: AuditReport;
  catalogues: Readonly<Record<string, Readonly<Record<string, string>>>>;
  sourceLocale: string;
}): RecordableFinding[] {
  const bounded = planCorrection({
    report: args.report,
    catalogues: args.catalogues,
    sourceLocale: args.sourceLocale,
  });

  /*
   * The same plan without the ceiling, and it is not a second rule — it is the
   * same function asked a second question: *which findings are correctable in
   * kind*, as opposed to *which will be corrected this time*.
   *
   * Needed because `planCorrection` answers both refusals with a sentence and
   * the structure cannot tell them apart: "nothing here is safe to correct"
   * and "41 translations are missing, over the 40 this corrects in one pass"
   * both arrive as `units: []` with every finding in `leftAlone`. Matching on
   * the message text would be a rule about prose. Comparing the two plans is a
   * fact about behaviour.
   */
  const unbounded = planCorrection({
    report: args.report,
    catalogues: args.catalogues,
    sourceLocale: args.sourceLocale,
    maxUnits: Number.MAX_SAFE_INTEGER,
  });

  /*
   * A unit is keyed by (locale, key), and so is a finding. Composite keys
   * rather than indexes, because the planner reorders: it groups by locale and
   * `report.findings` is in audit order.
   */
  const pair = (locale: string | null | undefined, key: string) =>
    JSON.stringify([locale ?? '', key]);

  const willCorrect = new Set(bounded.units.map((u) => pair(u.locale, u.key)));
  const couldCorrect = new Set(
    unbounded.units.map((u) => pair(u.locale, u.key)),
  );

  /*
   * Only when the ceiling is what stopped it: the unbounded plan found work
   * and the bounded one took none. Otherwise the refusal is per-finding and
   * the kind explains it.
   */
  const ceilingRefusal =
    bounded.units.length === 0 && unbounded.units.length > 0
      ? bounded.refusal
      : null;

  return args.report.findings.map((finding) => {
    const key = pair(finding.locale, finding.key);
    const ok = willCorrect.has(key);

    return {
      kind: finding.kind,
      key: finding.key,
      locale: finding.locale ?? null,
      detail: finding.detail,
      correctable: ok,
      refusalReason: ok
        ? null
        : // The ceiling only explains a finding it actually blocked. A
          // placeholder mismatch in the same batch is refused on its own
          // merits, and saying "over the 40" about it would be false.
          ((couldCorrect.has(key) ? ceilingRefusal : null) ??
          REFUSAL_BY_KIND[finding.kind] ??
          'This one is not corrected automatically.'),
    };
  });
}

/**
 * Why each kind is left for a person, in the planner's own terms.
 *
 * These are the reasons `correct.ts` gives in its docstring, moved to where a
 * reader meets them. A placeholder mismatch means an existing translation
 * disagrees with its source and which is wrong is a judgement; `missing-source`
 * means inventing product copy.
 */
const REFUSAL_BY_KIND: Record<string, string> = {
  'placeholder-mismatch':
    'An existing translation disagrees with its source. Which of the two is wrong is a judgement, and overwriting the translation to make this check pass would discard somebody’s work.',
  'icu-invalid':
    'The existing translation’s ICU message is broken. Rewriting it automatically would be guessing at what it was meant to say.',
  'missing-source':
    'The code calls a key the source locale does not define. Writing the source text would be inventing product copy.',
  'missing-translation':
    'The source locale does not define this key with any text to translate from.',
};

export interface RecordCheckInput {
  organizationId: string;
  owner: string;
  repo: string;
  pullNumber: number;
  headSha: string;
  conclusion: 'success' | 'neutral' | 'failure' | 'skipped';
  title: string;
  summary: string;
  keysChecked: number | null;
  localesChecked: readonly string[];
  skippedReason: string | null;
  checkRunId: number | null;
  checkRunUrl: string | null;
  /** Null means "this call is about the correction"; the stored list is kept. */
  findings: readonly RecordableFinding[] | null;
  correction: {
    requested: number;
    applied: number;
    refused: number;
    note: string | null;
    prNumber: number | null;
    prUrl: string | null;
  } | null;
}

/** Writes the check. Returns its id, or null when nothing could be written. */
export async function recordCheck(
  input: RecordCheckInput,
): Promise<string | null> {
  if (!readServiceRoleKey()) {
    console.error(
      'SUPABASE_SERVICE_ROLE_KEY is not set; the i18n check was published to GitHub but not indexed',
    );
    return null;
  }

  try {
    const { data, error } = await createAdminClient().rpc('record_i18n_check', {
      p_organization_id: input.organizationId,
      p_repository_owner: input.owner,
      p_repository_name: input.repo,
      p_pull_number: input.pullNumber,
      p_head_sha: input.headSha,
      p_conclusion: input.conclusion,
      p_title: input.title,
      p_summary: input.summary,
      p_keys_checked: input.keysChecked,
      p_locales_checked: [...input.localesChecked],
      p_skipped_reason: input.skippedReason,
      p_check_run_id: input.checkRunId,
      p_check_run_url: input.checkRunUrl,
      p_findings: input.findings ? [...input.findings] : null,
      p_correction: input.correction,
    });
    if (error) throw new Error(error.message);
    return typeof data === 'string' ? data : null;
  } catch (error) {
    // Logged whole and swallowed. See the fail-open reasoning above: the check
    // is already on the commit, and a missing row is a missing list entry.
    console.error('could not index the i18n check:', error);
    return null;
  }
}
