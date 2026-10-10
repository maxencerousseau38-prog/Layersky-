-- Closer is for its designated operators, not for everyone in the workspace.
--
-- ## The defect
--
-- Every Closer table gated reads on `is_org_member(organization_id)`, and every
-- Closer write function guarded on the same predicate. So *any* member of the
-- organization that has Closer enabled could read the pipeline — companies,
-- contacts, leads, stage history, loss reasons, drafted messages, replies,
-- suppressions — and could call all twenty write functions.
--
-- Not currently exposing anything: production holds one organization with
-- exactly one membership. It becomes real the first time a collaborator is
-- invited to that workspace, and "we have not invited anyone yet" is not an
-- access control.
--
-- ## Why the write path had to change too
--
-- Tightening the select policies alone would have been theatre. All twelve
-- policies are `for select`; writes go through `closer_*` functions that are
-- `security definer` and therefore **bypass RLS entirely**. A member who could
-- no longer read a lead could still have moved its stage by calling
-- `closer_set_stage` over PostgREST with an organization id they already know —
-- their own.
--
-- ## The mechanism
--
-- One predicate, consulted from both paths:
--
--   * `closer_operators` — an explicit grant per (organization, user).
--   * `is_closer_operator(org)` — membership **and** a grant row.
--   * the twelve select policies call it instead of `is_org_member`.
--   * a trigger on each data table calls it before any write, which closes the
--     `security definer` bypass without rewriting twenty function bodies.
--
-- Requiring membership *as well as* a grant is deliberate: removing somebody
-- from the workspace then also removes their Closer access, rather than
-- leaving a grant row that outlives the relationship it was issued for.
--
-- ## Why a table rather than a role
--
-- `organization_role` is `owner | admin | member`, and it answers a different
-- question: who administers this workspace. Reusing `owner` would mean the
-- person who pays for a workspace automatically reads the sales pipeline, which
-- is the conflation this migration exists to undo. There was no user-level
-- operator mechanism anywhere in the schema to reuse — `closer_workspaces`
-- designates an *organization* (`organization_id`, `note`, `enabled_at`) and
-- names no user, and the only `_by` columns on Closer tables record who *acted*,
-- never who was *authorised*.

create table public.closer_operators (
  organization_id uuid not null
    references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  granted_at timestamptz not null default now(),
  /*
   * Why this person. `organization_entitlements.granted_reason` set the
   * precedent: a privilege granted by hand with no recorded reason is one
   * nobody can audit later.
   */
  granted_reason text,
  primary key (organization_id, user_id)
);

comment on table public.closer_operators is
  'Explicit per-user authorisation to use Closer. Membership of the organization is necessary and not sufficient.';

alter table public.closer_operators enable row level security;

/*
 * You may see your own grant, and nothing else.
 *
 * Deliberately *not* `is_closer_operator(organization_id)`: that function reads
 * this table, so using it here would recurse. Self-only also leaks nothing —
 * an operator has no need to enumerate the others, and a member learns only
 * that they hold no grant, which they can already infer from the 404.
 */
create policy closer_operators_select_self on public.closer_operators
  for select
  using (user_id = auth.uid());

revoke all on public.closer_operators from public, anon;
grant select on public.closer_operators to authenticated;

/*
 * The one authorisation predicate.
 *
 * `security definer` so it can read `closer_operators` without the policy above
 * limiting it to the caller's own row, and so a policy that calls it does not
 * recurse through RLS.
 */
create or replace function public.is_closer_operator(org uuid)
returns boolean
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select public.is_org_member(org)
     and exists (
           select 1
           from public.closer_operators o
           where o.organization_id = org
             and o.user_id = auth.uid()
         );
$$;

comment on function public.is_closer_operator(uuid) is
  'True when the caller is a member of the organization AND holds an explicit closer_operators grant for it.';

revoke execute on function public.is_closer_operator(uuid) from public, anon;
grant execute on function public.is_closer_operator(uuid) to authenticated;

/* ------------------------------------------------------------------ *
 * Bootstrap, so applying this does not lock the current operator out
 * ------------------------------------------------------------------ */

/*
 * A one-time grant to the `owner` of each organization that already has Closer
 * enabled. **This is not the ongoing rule** — from here on the rule is a row in
 * `closer_operators`, and being an owner grants nothing by itself.
 *
 * `owner`, not every member: the whole point of the migration. In production
 * this writes exactly one row, and that user is corroborated three ways
 * independently of this query — they created the organization, they are its
 * sole member, and they are the only actor on every `closer_stage_history` row
 * with no nulls. In the development seed it grants the `acceptance` owner and
 * leaves `member@localize-infra.dev` denied, which is the fixture the proofs
 * need.
 *
 * No identifier is written here that is not already in the database.
 */
insert into public.closer_operators (organization_id, user_id, granted_reason)
select
  cw.organization_id,
  m.user_id,
  'bootstrap 20261010000100: owner of a Closer-enabled workspace when explicit operator authorisation was introduced'
from public.closer_workspaces cw
join public.organization_members m
  on m.organization_id = cw.organization_id
 and m.role = 'owner'
on conflict (organization_id, user_id) do nothing;

/* ------------------------------------------------------------------ *
 * Reads
 * ------------------------------------------------------------------ */

/*
 * Twelve policies, each `is_org_member` -> `is_closer_operator`.
 *
 * Dropped and recreated rather than altered: `alter policy ... using` exists,
 * but recreating keeps the statement self-describing for anybody reading this
 * file to learn what the policy now says.
 *
 * The three reference tables are deliberately untouched —
 * `closer_track_stages`, `closer_stage_transitions` and
 * `closer_loss_reason_stages` are `using (true)` and hold taxonomy: which
 * stages exist, which transitions are legal, which loss reason pairs with which
 * exit stage. No company, contact, lead or note is in them, and
 * `packages/closer-core` mirrors the same taxonomy in TypeScript that ships to
 * the browser. Restricting them would protect nothing and break the enum
 * lookups the pipeline page needs.
 */
drop policy closer_workspaces_select_member on public.closer_workspaces;
create policy closer_workspaces_select_operator on public.closer_workspaces
  for select using (public.is_closer_operator(organization_id));

drop policy closer_companies_select on public.closer_companies;
create policy closer_companies_select on public.closer_companies
  for select using (public.is_closer_operator(organization_id));

drop policy closer_contacts_select on public.closer_contacts;
create policy closer_contacts_select on public.closer_contacts
  for select using (public.is_closer_operator(organization_id));

drop policy closer_evidence_select on public.closer_evidence;
create policy closer_evidence_select on public.closer_evidence
  for select using (public.is_closer_operator(organization_id));

drop policy closer_leads_select on public.closer_leads;
create policy closer_leads_select on public.closer_leads
  for select using (public.is_closer_operator(organization_id));

drop policy closer_stage_history_select on public.closer_stage_history;
create policy closer_stage_history_select on public.closer_stage_history
  for select using (public.is_closer_operator(organization_id));

drop policy closer_messages_select on public.closer_messages;
create policy closer_messages_select on public.closer_messages
  for select using (public.is_closer_operator(organization_id));

drop policy closer_replies_select on public.closer_replies;
create policy closer_replies_select on public.closer_replies
  for select using (public.is_closer_operator(organization_id));

drop policy closer_scores_select on public.closer_scores;
create policy closer_scores_select on public.closer_scores
  for select using (public.is_closer_operator(organization_id));

drop policy closer_suppressions_select on public.closer_suppressions;
create policy closer_suppressions_select on public.closer_suppressions
  for select using (public.is_closer_operator(organization_id));

drop policy closer_jobs_select on public.closer_jobs;
create policy closer_jobs_select on public.closer_jobs
  for select using (public.is_closer_operator(organization_id));

drop policy closer_ai_executions_select on public.closer_ai_executions;
create policy closer_ai_executions_select on public.closer_ai_executions
  for select using (public.is_closer_operator(organization_id));

/* ------------------------------------------------------------------ *
 * Writes — closing the security definer bypass
 * ------------------------------------------------------------------ */

/*
 * One trigger function, on every table that carries commercial data.
 *
 * This rather than editing twenty function bodies, for three reasons: it is one
 * place to read instead of twenty, it cannot be forgotten by a *future*
 * function that writes these tables, and it does not require reproducing
 * twenty bodies correctly in a migration.
 *
 * `auth.uid() is null` is allowed through, and that is not a hole. A null
 * subject means there is no JWT: `service_role`, a migration, or the seed. Those
 * callers can already do anything — `service_role` bypasses RLS by design, and
 * every `service_role`-only function in this schema rests on the same argument.
 * `anon` cannot reach here: it holds no grant on any `closer_*` function and no
 * policy admits it.
 *
 * Verified before being relied on: `auth.uid()` is visible inside a trigger
 * fired from a `security definer` function and resolves to the **calling**
 * user, not the function owner.
 */
create or replace function public.closer_require_operator()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  org uuid;
  row_data jsonb;
begin
  if auth.uid() is null then
    return coalesce(new, old);
  end if;

  row_data := to_jsonb(coalesce(new, old));
  org := (row_data ->> 'organization_id')::uuid;

  /*
   * Fail closed rather than fall through. A table reaching this trigger without
   * an organization to check is a schema change that outran this guard, and the
   * safe answer is a refusal somebody notices.
   */
  if org is null then
    raise exception
      'closer: % on % carries no organization_id, so operator authorisation cannot be checked',
      tg_op, tg_table_name
      using errcode = '42501';
  end if;

  if not public.is_closer_operator(org) then
    raise exception
      'closer is restricted to the operators designated for this workspace'
      using errcode = '42501';
  end if;

  return coalesce(new, old);
end;
$$;

comment on function public.closer_require_operator() is
  'Write guard for Closer tables. Refuses any JWT-bearing caller without a closer_operators grant, closing the RLS bypass that security definer write functions have.';

/*
 * Nobody may call it directly, and `anon` is named explicitly.
 *
 * `revoke ... from public` alone does **not** remove it: Supabase grants `anon`
 * directly rather than through PUBLIC, so the grant survives — a migration in
 * this repository shipped with exactly that hole and `get_advisors` found it.
 * It found this one too, on the first run after this function was written.
 *
 * Revoked from `authenticated` as well, which costs nothing: PostgreSQL does
 * not check EXECUTE on a trigger function when firing a trigger, so the guard
 * keeps working while the `/rest/v1/rpc/closer_require_operator` route stops
 * being callable by anyone. Verified rather than assumed — the Closer suite was
 * re-run after this revoke.
 */
revoke all on function public.closer_require_operator() from public, anon, authenticated;

create trigger closer_companies_require_operator
  before insert or update or delete on public.closer_companies
  for each row execute function public.closer_require_operator();

create trigger closer_contacts_require_operator
  before insert or update or delete on public.closer_contacts
  for each row execute function public.closer_require_operator();

create trigger closer_evidence_require_operator
  before insert or update or delete on public.closer_evidence
  for each row execute function public.closer_require_operator();

create trigger closer_leads_require_operator
  before insert or update or delete on public.closer_leads
  for each row execute function public.closer_require_operator();

create trigger closer_stage_history_require_operator
  before insert or update or delete on public.closer_stage_history
  for each row execute function public.closer_require_operator();

create trigger closer_messages_require_operator
  before insert or update or delete on public.closer_messages
  for each row execute function public.closer_require_operator();

create trigger closer_replies_require_operator
  before insert or update or delete on public.closer_replies
  for each row execute function public.closer_require_operator();

create trigger closer_scores_require_operator
  before insert or update or delete on public.closer_scores
  for each row execute function public.closer_require_operator();

create trigger closer_suppressions_require_operator
  before insert or update or delete on public.closer_suppressions
  for each row execute function public.closer_require_operator();

create trigger closer_jobs_require_operator
  before insert or update or delete on public.closer_jobs
  for each row execute function public.closer_require_operator();

create trigger closer_ai_executions_require_operator
  before insert or update or delete on public.closer_ai_executions
  for each row execute function public.closer_require_operator();

/*
 * `closer_workspaces` gets no trigger, and that is deliberate.
 *
 * Enabling Closer for an organization is the act that *creates* the first
 * operator relationship, so a guard requiring an existing grant would make the
 * first one unreachable. It has no `insert`, `update` or `delete` policy and no
 * function granted to `authenticated` writes it, so the only writers are
 * `service_role`, a migration and the seed — exactly the callers the trigger
 * would wave through anyway.
 */
