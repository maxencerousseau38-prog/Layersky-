import 'server-only';
import { createClient } from '@/lib/supabase/server';

/**
 * Reading the i18n health checks a workspace has accumulated.
 *
 * Under RLS, with the member's own session — the same way `/[org]/usage` reads
 * `api_usage_daily`. Isolation is the database's: another workspace's check is
 * a 404 because the policy returns nothing, not because this file decided so.
 *
 * Every row here is an index of something GitHub holds. The links back to the
 * check run and the corrective pull request are not decoration; they are the
 * way a reader reaches the artefact this is only a summary of.
 */

export interface HealthCheckRow {
  id: string;
  organizationId: string;
  repositoryOwner: string;
  repositoryName: string;
  pullNumber: number;
  headSha: string;
  conclusion: 'success' | 'neutral' | 'failure' | 'skipped';
  title: string;
  summary: string;
  keysChecked: number | null;
  localesChecked: string[];
  skippedReason: string | null;
  checkRunUrl: string | null;
  correctionRequested: number | null;
  correctionApplied: number | null;
  correctionRefused: number | null;
  correctionNote: string | null;
  correctivePrNumber: number | null;
  correctivePrUrl: string | null;
  findingCount: number;
  createdAt: string;
}

export interface HealthFinding {
  id: string;
  kind:
    | 'missing-translation'
    | 'missing-source'
    | 'placeholder-mismatch'
    | 'icu-invalid';
  key: string;
  locale: string | null;
  detail: string;
  correctable: boolean;
  refusalReason: string | null;
}

const CHECK_SELECT = `
  id, organization_id, repository_owner, repository_name, pull_number, head_sha,
  conclusion, title, summary, keys_checked, locales_checked, skipped_reason,
  check_run_url, correction_requested, correction_applied, correction_refused,
  correction_note, corrective_pr_number, corrective_pr_url, created_at,
  i18n_findings(count)
`;

/* biome-ignore lint/suspicious/noExplicitAny: PostgREST rows are untyped here;
   the mapping below is the only place their shape is asserted. */
function toRow(record: any): HealthCheckRow {
  return {
    id: record.id,
    organizationId: record.organization_id,
    repositoryOwner: record.repository_owner,
    repositoryName: record.repository_name,
    pullNumber: record.pull_number,
    headSha: record.head_sha,
    conclusion: record.conclusion,
    title: record.title,
    summary: record.summary,
    keysChecked: record.keys_checked,
    localesChecked: record.locales_checked ?? [],
    skippedReason: record.skipped_reason,
    checkRunUrl: record.check_run_url,
    correctionRequested: record.correction_requested,
    correctionApplied: record.correction_applied,
    correctionRefused: record.correction_refused,
    correctionNote: record.correction_note,
    correctivePrNumber: record.corrective_pr_number,
    correctivePrUrl: record.corrective_pr_url,
    findingCount: record.i18n_findings?.[0]?.count ?? 0,
    createdAt: record.created_at,
  };
}

export interface ViewerChecks {
  checks: HealthCheckRow[];
  /** True when the workspace has checks this page is not showing. */
  truncated: boolean;
}

/**
 * The workspace's recent checks, newest first.
 *
 * One extra row is fetched to answer "is there more?" without `count: 'exact'`,
 * which would make Postgres walk the table under RLS for a number the page
 * does not otherwise need. The same trick `listRunsForViewer` uses, and the
 * same honesty requirement: a page that says "50 checks" past fifty is stating
 * a window as a total.
 */
export async function listChecks(
  organizationId: string,
  limit = 50,
): Promise<ViewerChecks> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('i18n_checks')
    .select(CHECK_SELECT)
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false })
    .limit(limit + 1);

  if (error) throw new Error(`Could not load health checks: ${error.message}`);
  const rows = (data ?? []).map(toRow);
  return { checks: rows.slice(0, limit), truncated: rows.length > limit };
}

export async function findCheck(id: string): Promise<HealthCheckRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('i18n_checks')
    .select(CHECK_SELECT)
    .eq('id', id)
    .maybeSingle();

  if (error) throw new Error(`Could not load the check: ${error.message}`);
  return data ? toRow(data) : null;
}

export async function listFindings(checkId: string): Promise<HealthFinding[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('i18n_findings')
    .select('id, kind, key, locale, detail, correctable, refusal_reason')
    .eq('check_id', checkId)
    .order('position', { ascending: true });

  if (error) throw new Error(`Could not load the findings: ${error.message}`);
  /* biome-ignore lint/suspicious/noExplicitAny: see `toRow`. */
  return (data ?? []).map((f: any) => ({
    id: f.id,
    kind: f.kind,
    key: f.key,
    locale: f.locale,
    detail: f.detail,
    correctable: f.correctable,
    refusalReason: f.refusal_reason,
  }));
}

/**
 * The three totals the list does not already show per row.
 *
 * Computed over the checks on the page and labelled as such by the caller. A
 * repository count rather than a check count, because the toolbar states the
 * check count and a tile repeating it is chrome — the rule `/runs` already
 * follows.
 */
export function summarise(checks: readonly HealthCheckRow[]): {
  repositories: number;
  openProblems: number;
  correctedKeys: number;
} {
  return {
    repositories: new Set(
      checks.map((c) => `${c.repositoryOwner}/${c.repositoryName}`),
    ).size,
    openProblems: checks.reduce((n, c) => n + c.findingCount, 0),
    correctedKeys: checks.reduce((n, c) => n + (c.correctionApplied ?? 0), 0),
  };
}
