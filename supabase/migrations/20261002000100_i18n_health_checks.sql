-- The i18n health check, indexed so a person can read it in the product.
--
-- The guardrail slice has been running since #124: a pull request arrives, the
-- webhook analyses it, publishes a GitHub Check, and — since #132 — opens a
-- corrective pull request. All of that is real and none of it is visible in
-- `apps/web`. Everything the dashboard shows is still the legacy
-- extraction → translation → PR pipeline, so the product a customer would buy
-- is the one part of it the product does not display.
--
-- ## Why a table, when invariant 1 says Git is the source of truth
--
-- Because this is the index, which is what that invariant reserves Postgres
-- for. The authority stays GitHub: the check run on the commit is the artefact,
-- the corrective pull request is the deliverable, and both are linked from
-- every row here. Nothing in this schema is read back to make a decision —
-- deleting it loses a list, never a result.
--
-- The alternative was to query GitHub on every page render: one installation
-- token, one list of repositories, one check-runs call per commit, per viewer,
-- per reload. That is slower, rate-limited, and still not a list — GitHub has
-- no "checks across this workspace" endpoint.
--
-- ## Why the webhook writes it with the service role
--
-- There is no session on that path. GitHub holds none, and the row belongs to
-- the workspace resolved from `organization_github_installations` — the same
-- lookup the quota charge already does (#133). Members read under RLS; nobody
-- writes but the service role.

create table public.i18n_checks (
  id uuid primary key default gen_random_uuid(),

  organization_id uuid not null
    references public.organizations (id) on delete cascade,

  -- Where it ran. Stored rather than joined to `projects`: a repository can be
  -- checked without ever being configured as a project, and requiring one
  -- would make the guardrail depend on the legacy pipeline's setup.
  repository_owner text not null,
  repository_name text not null,
  pull_number integer not null,
  head_sha text not null,

  -- What the check concluded, in GitHub's own vocabulary so the two cannot
  -- drift. `neutral` is the product decision from #124: never `failure`.
  conclusion text not null
    check (conclusion in ('success', 'neutral', 'failure', 'skipped')),
  title text not null,
  summary text not null,

  -- Null when the repository could not be analysed at all, which is a
  -- different fact from "analysed, found nothing" and must not collapse into
  -- a zero.
  keys_checked integer check (keys_checked >= 0),
  locales_checked text[] not null default '{}',
  skipped_reason text,

  check_run_id bigint,
  check_run_url text,

  -- The correction, when one was attempted. Three nullable counts rather than
  -- a status string: `requested = applied + rejected` is the invariant
  -- `buildCorrection` guarantees, and storing the parts lets a reader check it
  -- rather than trust a label.
  correction_requested integer check (correction_requested >= 0),
  correction_applied integer check (correction_applied >= 0),
  correction_refused integer check (correction_refused >= 0),
  -- Why nothing was opened, when nothing was. Carries the sentence the check
  -- already shows, so the two surfaces cannot disagree.
  correction_note text,
  corrective_pr_number integer,
  corrective_pr_url text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- GitHub keys check runs by (name, head_sha) and so does this. A redelivery
  -- updates the row instead of stacking a second one, which is the same
  -- idempotence `publishCheck` relies on and for the same reason — no table of
  -- deliveries, no bookkeeping of our own.
  unique (repository_owner, repository_name, head_sha)
);

create index i18n_checks_by_org on public.i18n_checks
  (organization_id, created_at desc);

-- One row per problem, so a reader can sort and filter them rather than read a
-- paragraph. `kind` mirrors `Finding['kind']` in packages/eval.
create table public.i18n_findings (
  id uuid primary key default gen_random_uuid(),
  check_id uuid not null
    references public.i18n_checks (id) on delete cascade,

  kind text not null check (kind in (
    'missing-translation',
    'missing-source',
    'placeholder-mismatch',
    'icu-invalid'
  )),
  key text not null,
  locale text,
  detail text not null,

  -- Whether the correction may act on this one, and why not when it may not.
  --
  -- Stored rather than recomputed in the UI. `planCorrection` is the authority
  -- on what is safe to correct — only `missing-translation`, and only when the
  -- source actually defines the key — and a second rule in a React component
  -- would be free to disagree with it. That is the duplicate-tally failure
  -- this repository keeps paying for.
  correctable boolean not null,
  refusal_reason text,

  position integer not null default 0
);

create index i18n_findings_by_check on public.i18n_findings (check_id, position);

alter table public.i18n_checks enable row level security;
alter table public.i18n_findings enable row level security;

-- Members may read their workspace's checks. No insert, update or delete
-- policy: the only writer is the webhook, through the definer function below.
create policy i18n_checks_select_member
  on public.i18n_checks
  for select to authenticated
  using (public.is_org_member(organization_id));

create policy i18n_findings_select_member
  on public.i18n_findings
  for select to authenticated
  using (
    exists (
      select 1 from public.i18n_checks c
       where c.id = check_id
         and public.is_org_member(c.organization_id)
    )
  );

/**
 * Record a check and its findings, atomically, replacing any earlier run for
 * the same commit.
 *
 * One function rather than an insert plus a loop, because a redelivery must not
 * be able to leave the old findings beside the new ones. Deleting and
 * re-inserting inside one statement is what makes "the row describes this
 * commit" true rather than hoped for.
 *
 * Returns the check id so the caller can link to it.
 */
create function public.record_i18n_check(
  p_organization_id uuid,
  p_repository_owner text,
  p_repository_name text,
  p_pull_number integer,
  p_head_sha text,
  p_conclusion text,
  p_title text,
  p_summary text,
  p_keys_checked integer,
  p_locales_checked text[],
  p_skipped_reason text,
  p_check_run_id bigint,
  p_check_run_url text,
  p_findings jsonb,
  p_correction jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  found_id uuid;
begin
  insert into public.i18n_checks as existing (
    organization_id, repository_owner, repository_name, pull_number, head_sha,
    conclusion, title, summary, keys_checked, locales_checked, skipped_reason,
    check_run_id, check_run_url,
    correction_requested, correction_applied, correction_refused,
    correction_note, corrective_pr_number, corrective_pr_url
  )
  values (
    p_organization_id, p_repository_owner, p_repository_name, p_pull_number,
    p_head_sha, p_conclusion, p_title, p_summary, p_keys_checked,
    coalesce(p_locales_checked, '{}'), p_skipped_reason,
    p_check_run_id, p_check_run_url,
    (p_correction ->> 'requested')::integer,
    (p_correction ->> 'applied')::integer,
    (p_correction ->> 'refused')::integer,
    p_correction ->> 'note',
    (p_correction ->> 'prNumber')::integer,
    p_correction ->> 'prUrl'
  )
  on conflict (repository_owner, repository_name, head_sha) do update
    set organization_id = excluded.organization_id,
        pull_number = excluded.pull_number,
        conclusion = excluded.conclusion,
        title = excluded.title,
        summary = excluded.summary,
        keys_checked = excluded.keys_checked,
        locales_checked = excluded.locales_checked,
        skipped_reason = excluded.skipped_reason,
        check_run_id = excluded.check_run_id,
        check_run_url = excluded.check_run_url,
        /*
         * The correction is written by a second call, after the first has
         * already stored the findings — so a null here must not erase what the
         * earlier call recorded. `coalesce` keeps the known value; a genuine
         * re-analysis overwrites it because it arrives with its own.
         */
        correction_requested =
          coalesce(excluded.correction_requested, existing.correction_requested),
        correction_applied =
          coalesce(excluded.correction_applied, existing.correction_applied),
        correction_refused =
          coalesce(excluded.correction_refused, existing.correction_refused),
        correction_note =
          coalesce(excluded.correction_note, existing.correction_note),
        corrective_pr_number =
          coalesce(excluded.corrective_pr_number, existing.corrective_pr_number),
        corrective_pr_url =
          coalesce(excluded.corrective_pr_url, existing.corrective_pr_url),
        updated_at = now()
  returning id into found_id;

  /*
   * Findings are replaced wholesale, and only when the caller supplied some.
   *
   * A null `p_findings` means "this call is about the correction, I did not
   * re-analyse" — deleting on that would empty the list the first call stored
   * and leave a check that found six problems showing none.
   */
  if p_findings is not null then
    delete from public.i18n_findings where check_id = found_id;

    insert into public.i18n_findings
      (check_id, kind, key, locale, detail, correctable, refusal_reason, position)
    select
      found_id,
      item ->> 'kind',
      item ->> 'key',
      item ->> 'locale',
      item ->> 'detail',
      coalesce((item ->> 'correctable')::boolean, false),
      item ->> 'refusalReason',
      (ordinality - 1)::integer
    from jsonb_array_elements(p_findings) with ordinality as t(item, ordinality);
  end if;

  return found_id;
end;
$$;

/*
 * `from public, anon` and not `from public` alone.
 *
 * Supabase grants execute to `anon` directly, not through PUBLIC, so revoking
 * PUBLIC leaves it. `get_advisors` caught exactly this on the previous
 * migration; every other migration in this directory writes both.
 */
revoke execute on function public.record_i18n_check(
  uuid, text, text, integer, text, text, text, text, integer, text[], text,
  bigint, text, jsonb, jsonb
) from public, anon, authenticated;

grant execute on function public.record_i18n_check(
  uuid, text, text, integer, text, text, text, text, integer, text[], text,
  bigint, text, jsonb, jsonb
) to service_role;

comment on table public.i18n_checks is
  'Index of i18n health checks published to GitHub, so a workspace can read its own history. GitHub holds the authority; losing this loses a list, never a result.';
comment on table public.i18n_findings is
  'One problem found by a check, with whether the automatic correction may act on it.';
