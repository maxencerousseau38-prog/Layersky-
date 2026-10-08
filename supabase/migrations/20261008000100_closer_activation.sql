-- Closer — the link between a lead and the workspace it activated, and the
-- counters that link makes readable.
--
-- ## The problem this solves, and the one it must not create
--
-- A design-partner lead lives in the **operator's** organization. A prospect
-- who signs up gets their **own**. So "did they install it, did a check run,
-- did they come back" are questions about another tenant's rows, and every
-- policy on those rows says `is_org_member(organization_id)` — which the
-- operator is not. A direct read returns nothing, correctly.
--
-- The dangerous fix is a `security definer` function callable by
-- `authenticated` that takes an organization id. That is an oracle into every
-- workspace, and this repository has already shipped it twice:
-- `closer_is_suppressed` answered any signed-in user about any organization's
-- opt-out list, and `link_github_installation` checked that the caller was an
-- admin of *their* organization rather than that they controlled the
-- installation they named. Both ended up `service_role`.
--
-- So everything here is `service_role`, takes the acting user as a parameter,
-- and checks that user's role against the **lead's** workspace. `apps/web`
-- holds the key and establishes authority before calling, exactly as
-- `lib/supabase/admin.ts` already does for `record_i18n_check` and
-- `consume_api_quota`.
--
-- ## No second tracking system
--
-- Nothing new is recorded about activation. `organization_github_installations`
-- already knows when the App was connected; `i18n_checks` already has one row
-- per checked commit with its timestamp. The milestones are **derived** from
-- those rows at read time. A `closer_activations` table carrying its own
-- `installed_at` would be a second account of the same facts, free to
-- disagree — the reason `lib/onboarding/steps.ts` stores no state either.
--
-- ## What crosses the boundary, and what does not
--
-- Counters and timestamps. Not repository names, not pull request numbers, not
-- findings, not titles, not summaries, not locales. Those are the prospect's
-- content and they did not agree to an operator reading them; the number of
-- repositories is activation, the name of one is not. The function below
-- selects columns explicitly for that reason rather than returning a row type
-- that would grow a leak the next time a column is added.

/* ------------------------------------------------------------------ *
 * The link
 * ------------------------------------------------------------------ */

/*
 * Three columns, and the provenance is not decoration.
 *
 * The match that suggests a link is evidence, not proof: a prospect can
 * install the App on a personal account for a company repository, and the
 * account login then matches nothing. So a human confirms, and "who decided
 * this" is the question an audit asks first — the same sentence
 * `closer_stage_history.actor` carries.
 */
alter table public.closer_leads
  add column activated_organization_id uuid
    references public.organizations (id) on delete set null,
  add column activation_confirmed_by uuid
    references auth.users (id) on delete set null,
  add column activation_confirmed_at timestamptz;

/*
 * One-directional on purpose.
 *
 * "A link implies provenance" is the invariant worth holding. The converse is
 * not: `on delete set null` fires when a prospect deletes their workspace, and
 * the provenance left behind with a null link is the one record that says a
 * link existed and the organization is gone. Requiring all three to be null
 * together would erase that, and a funnel that cannot tell "never linked" from
 * "linked, then deleted" cannot explain a lost design partner.
 */
alter table public.closer_leads
  add constraint closer_leads_activation_has_provenance check (
    activated_organization_id is null
    or (activation_confirmed_by is not null and activation_confirmed_at is not null)
  );

/*
 * One prospect workspace, at most one lead.
 *
 * Partial, because unlinked leads are the common case and a plain unique
 * constraint would allow exactly one of them. Two leads claiming the same
 * organization would double-count an activation and make the funnel report
 * two design partners where there is one.
 */
create unique index closer_leads_one_lead_per_activated_org
  on public.closer_leads (activated_organization_id)
  where activated_organization_id is not null;

comment on column public.closer_leads.activated_organization_id is
  'The Layersky workspace this lead signed up as, once an operator confirmed the match. Null until then, and null again if that workspace is deleted.';

/* ------------------------------------------------------------------ *
 * Authority, in one place
 * ------------------------------------------------------------------ */

/**
 * May this user act on this lead's activation?
 *
 * Owner or admin of the lead's organization, and that organization must have
 * the Closer enabled. Two conditions rather than one: `closer_workspaces` is
 * the opt-in that gates the whole subsystem, and a role check alone would let
 * an admin of any workspace reach these functions the moment one of them
 * acquired a lead row.
 *
 * `NULL` is a refusal. `org_role` returns NULL for a non-member, `NULL not in
 * (…)` is NULL, and a PL/pgSQL `IF` does not take a NULL branch — which is the
 * exact defect `20260916000200` fixed in `link_github_installation`, where a
 * user outside the organization wrote its GitHub link. Written as
 * `is null or … not in` for that reason, and the non-member case is tested.
 */
create or replace function public.closer_may_manage_activation(
  p_lead_id uuid,
  p_user_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  org uuid;
  acting public.organization_role;
begin
  if p_user_id is null then
    return false;
  end if;

  select l.organization_id into org
    from public.closer_leads l
   where l.id = p_lead_id;
  if org is null then
    return false;
  end if;

  if not exists (select 1 from public.closer_workspaces w
                  where w.organization_id = org) then
    return false;
  end if;

  select m.role into acting
    from public.organization_members m
   where m.organization_id = org and m.user_id = p_user_id;

  if acting is null or acting not in ('owner', 'admin') then
    return false;
  end if;

  return true;
end;
$$;

revoke execute on function public.closer_may_manage_activation(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.closer_may_manage_activation(uuid, uuid)
  to service_role;

/* ------------------------------------------------------------------ *
 * Suggesting the link
 * ------------------------------------------------------------------ */

/**
 * Which workspaces look like this lead, and why.
 *
 * The match is `closer_companies.repository`'s owner against
 * `organization_github_installations.account_login`. Discovery writes
 * `repository` as GitHub's `full_name` — `owner/name` — so the owner is the
 * first path segment, and when a prospect installs the App on that account the
 * two meet. Nothing else in either database connects a prospect to a lead.
 *
 * **A list, never a choice.** Two leads can point at repositories under one
 * owner, and one account can match several companies. Picking for the operator
 * would be the agent guessing at an ambiguity instead of raising it
 * (invariant 4), and the thing being guessed at grants read access to another
 * tenant.
 *
 * Returns the organization's name and slug because an operator has to
 * recognise what they are confirming. That is the workspace's own identity,
 * not its content — no check, no repository, no finding.
 */
create or replace function public.closer_activation_candidates(
  p_lead_id uuid,
  p_user_id uuid
)
returns table (
  organization_id uuid,
  organization_name text,
  organization_slug text,
  account_login text,
  account_type text,
  connected_at timestamptz,
  match_reason text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  lead_org uuid;
  owner_login text;
begin
  if not public.closer_may_manage_activation(p_lead_id, p_user_id) then
    raise exception 'not allowed to manage this lead''s activation'
      using errcode = '42501';
  end if;

  select l.organization_id, split_part(c.repository, '/', 1)
    into lead_org, owner_login
    from public.closer_leads l
    join public.closer_companies c on c.id = l.company_id
   where l.id = p_lead_id;

  -- No repository means no identifier to match on. An empty result, not an
  -- error: a company discovered from a website is a legitimate lead that
  -- simply cannot be matched this way.
  if owner_login is null or length(trim(owner_login)) = 0 then
    return;
  end if;

  return query
  select o.id,
         o.name,
         o.slug,
         i.account_login,
         i.account_type,
         i.connected_at,
         format('GitHub account %s matches the repository owner in %s',
                i.account_login, c.repository)
    from public.organization_github_installations i
    join public.organizations o on o.id = i.organization_id
    join public.closer_leads l on l.id = p_lead_id
    join public.closer_companies c on c.id = l.company_id
   where lower(i.account_login) = lower(owner_login)
     /*
      * Never the Closer workspace itself.
      *
      * Production currently holds exactly one organization — the operator's,
      * which carries both the installation and every check. Without this an
      * operator could link a lead to their own workspace and watch every
      * milestone light up from their own fixture testing, which is the most
      * convincing wrong answer this subsystem could give.
      */
     and i.organization_id <> lead_org
     -- And not a workspace another lead already claims.
     and not exists (
       select 1 from public.closer_leads other
        where other.activated_organization_id = i.organization_id
          and other.id <> p_lead_id
     );
end;
$$;

revoke execute on function public.closer_activation_candidates(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.closer_activation_candidates(uuid, uuid)
  to service_role;

/* ------------------------------------------------------------------ *
 * Confirming it
 * ------------------------------------------------------------------ */

/**
 * Write the link, and only for an organization the evidence supports.
 *
 * The organization id is not taken on trust. It has to appear in
 * `closer_activation_candidates` for this lead — which means it has a GitHub
 * installation whose account matches the company's repository owner, it is not
 * the operator's own workspace, and no other lead claims it. An operator
 * confirming something is a decision about which candidate; it is not a way to
 * nominate an arbitrary workspace.
 *
 * That distinction is the whole security boundary. Checking the role and then
 * trusting the id is precisely the shape `link_github_installation` had when it
 * let a member bind another customer's installation.
 */
create or replace function public.closer_link_activation(
  p_lead_id uuid,
  p_organization_id uuid,
  p_user_id uuid
)
returns public.closer_leads
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  updated public.closer_leads;
begin
  if not public.closer_may_manage_activation(p_lead_id, p_user_id) then
    raise exception 'not allowed to manage this lead''s activation'
      using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.closer_activation_candidates(p_lead_id, p_user_id) c
     where c.organization_id = p_organization_id
  ) then
    raise exception 'that workspace is not a candidate for this lead'
      using errcode = '22023';
  end if;

  update public.closer_leads
     set activated_organization_id = p_organization_id,
         activation_confirmed_by = p_user_id,
         activation_confirmed_at = now()
   where id = p_lead_id
  returning * into updated;

  return updated;
end;
$$;

revoke execute on function public.closer_link_activation(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.closer_link_activation(uuid, uuid, uuid)
  to service_role;

/**
 * Take it back.
 *
 * Clears the provenance too, which the `on delete set null` path deliberately
 * does not: an operator undoing their own mistake is a different fact from a
 * prospect deleting their workspace, and only the second one should leave a
 * trace saying a link once existed.
 */
create or replace function public.closer_unlink_activation(
  p_lead_id uuid,
  p_user_id uuid
)
returns public.closer_leads
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  updated public.closer_leads;
begin
  if not public.closer_may_manage_activation(p_lead_id, p_user_id) then
    raise exception 'not allowed to manage this lead''s activation'
      using errcode = '42501';
  end if;

  update public.closer_leads
     set activated_organization_id = null,
         activation_confirmed_by = null,
         activation_confirmed_at = null
   where id = p_lead_id
  returning * into updated;

  return updated;
end;
$$;

revoke execute on function public.closer_unlink_activation(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.closer_unlink_activation(uuid, uuid)
  to service_role;

/* ------------------------------------------------------------------ *
 * The counters
 * ------------------------------------------------------------------ */

/**
 * What the linked workspace has done, as numbers and dates.
 *
 * Every column is listed explicitly, and that is a security decision rather
 * than a style one: `select i.*` would grow a leak the next time `i18n_checks`
 * gains a column. What is deliberately absent is the prospect's content —
 * repository names, pull request numbers, check titles, summaries, findings,
 * locales. `repositories_checked` is a count; the names behind it are not an
 * activation signal, they are somebody else's code.
 *
 * `paid` is **not** here as a boolean. `organization_entitlements` carries
 * `stripe_subscription_id`, the column a payment would write — and nothing in
 * this repository writes it, zero rows have one, and there is no Stripe
 * integration. So the column is read and reported as what it is: a modelled
 * signal that is false for everybody because nobody has paid. Deriving `paid`
 * from `plan = 'pro'` would be worse, because `plan` is set by hand and
 * `private_repositories` is granted on connection with the plan left at free.
 *
 * `pricing` is absent entirely. "They asked what it costs" happens in a
 * conversation and no table records it. Returning false would assert a
 * measurement nobody took, which is the failure
 * `scoreIcp`'s "not assessed" components exist to avoid.
 */
create or replace function public.closer_activation_metrics(
  p_lead_id uuid,
  p_user_id uuid
)
returns table (
  activated_organization_id uuid,
  installed_at timestamptz,
  first_check_at timestamptz,
  last_check_at timestamptz,
  checks_total bigint,
  distinct_check_days bigint,
  distinct_pull_requests bigint,
  repositories_checked bigint,
  corrections_applied bigint,
  has_paid_subscription boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  org uuid;
begin
  if not public.closer_may_manage_activation(p_lead_id, p_user_id) then
    raise exception 'not allowed to manage this lead''s activation'
      using errcode = '42501';
  end if;

  select l.activated_organization_id into org
    from public.closer_leads l
   where l.id = p_lead_id;

  /*
   * No link, no counters, and no row of zeroes.
   *
   * Zero checks and "we have not linked this lead to a workspace" are
   * different facts, and a row of zeroes reads as the first. The caller
   * distinguishes them by getting nothing back.
   */
  if org is null then
    return;
  end if;

  return query
  select
    org,
    (select i.connected_at
       from public.organization_github_installations i
      where i.organization_id = org),
    /*
     * `min(created_at)`, not `min(updated_at)`. A redelivery updates the row
     * it already has — that is the idempotence `publishCheck` relies on — so
     * `updated_at` moves and would report a first check that happened later
     * than it did.
     */
    (select min(c.created_at) from public.i18n_checks c where c.organization_id = org),
    (select max(c.created_at) from public.i18n_checks c where c.organization_id = org),
    (select count(*) from public.i18n_checks c where c.organization_id = org),
    -- UTC, because the daily quota resets at 00:00 UTC and two date notions in
    -- one product is how two numbers start disagreeing.
    (select count(distinct (c.created_at at time zone 'utc')::date)
       from public.i18n_checks c where c.organization_id = org),
    (select count(distinct (c.repository_owner, c.repository_name, c.pull_number))
       from public.i18n_checks c where c.organization_id = org),
    (select count(distinct (c.repository_owner, c.repository_name))
       from public.i18n_checks c where c.organization_id = org),
    (select coalesce(sum(c.correction_applied), 0)
       from public.i18n_checks c where c.organization_id = org),
    (select e.stripe_subscription_id is not null
       from public.organization_entitlements e
      where e.organization_id = org);
end;
$$;

revoke execute on function public.closer_activation_metrics(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.closer_activation_metrics(uuid, uuid)
  to service_role;
