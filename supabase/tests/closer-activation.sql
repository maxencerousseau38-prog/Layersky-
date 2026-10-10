-- Design-partner activation: the operator reads counters about another tenant,
-- and nothing else.
--
-- ## What makes this file necessary rather than thorough
--
-- Every other Closer function answers about the operator's own organization.
-- These five answer about a **prospect's**, because that is where the
-- activation rows live — `organization_github_installations.connected_at` and
-- `i18n_checks.created_at` belong to the workspace that signed up, not to the
-- workspace that found it.
--
-- So this is the first deliberate cross-tenant read in the product, and this
-- repository has shipped the wrong version of that twice:
-- `closer_is_suppressed` answered any signed-in user about any organization's
-- opt-out list, and `link_github_installation` checked that the caller was an
-- admin of *their* organization rather than that they controlled the
-- installation they named. Both are in `tenant-isolation.sql` now. This file
-- exists so the third one is caught here instead of in an audit.
--
-- ## The assertion that matters most
--
-- `noncandidate-link-refused`. If an operator could write
-- `activated_organization_id` to an arbitrary id, they would hold a read
-- oracle on every workspace in the product — and the role check alone does not
-- stop it, because the role is real. What stops it is that the id has to
-- appear in `closer_activation_candidates`, which means a GitHub installation
-- whose account matches the company's repository owner.
--
-- Like the other proofs here this ends in a deliberate RAISE: the transaction
-- rolls back, the database is left as it was found, and the verdict is read
-- out of the error message by supabase/tests/run.sh.
do $$
declare
  u_op       uuid := 'a1111111-1111-4111-8111-111111111111';
  u_member   uuid := 'a2222222-2222-4222-8222-222222222222';
  u_outsider uuid := 'a3333333-3333-4333-8333-333333333333';
  u_prospect uuid := 'a4444444-4444-4444-8444-444444444444';
  org_op uuid;
  org_prospect uuid;
  org_other uuid;
  c_match public.closer_companies;
  c_nomatch public.closer_companies;
  lead_match public.closer_leads;
  lead_nomatch public.closer_leads;
  m record;
  n int;
  r text := '';
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
  select x.id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',x.em,'',now(),now()
  from (values (u_op,'act-op@test.invalid'),(u_member,'act-mem@test.invalid'),
               (u_outsider,'act-out@test.invalid'),(u_prospect,'act-pro@test.invalid')) x(id,em)
  on conflict (id) do nothing;

  /* ---- the operator's Closer workspace -------------------------------- */

  perform set_config('request.jwt.claims', json_build_object('sub',u_op,'role','authenticated')::text, true);
  perform set_config('role','authenticated',true);
  org_op := (public.create_organization('Op','act-op-'||floor(random()*100000)::text)).id;

  /*
   * This proof's operator.
   *
   * `20261010000100_closer_operators.sql` made Closer writes require an
   * explicit `closer_operators` grant, so a proof that builds its own fixtures
   * has to grant itself one. That makes the fixture more honest rather than
   * less: it now models a real operator instead of any member of the
   * organization, which is what the product no longer accepts.
   *
   * Written as `postgres` because the write guard waves through a caller with
   * no JWT subject, and rolled back with everything else.
   */
  perform set_config('role','postgres',true);
  insert into public.closer_operators (organization_id, user_id, granted_reason)
  values (org_op, u_op, 'proof fixture: this script is the operator');
  perform set_config('role','authenticated',true);

  -- One company whose repository owner can match an installation, and one
  -- discovered from a website with no repository at all. The second is a
  -- legitimate lead that simply cannot be matched this way.
  c_match := public.closer_upsert_company(
    org_op,'AcmeCorp','acme-act.test','github_repository',
    'https://github.com/acmecorp/web','acmecorp/web');
  c_nomatch := public.closer_upsert_company(
    org_op,'NoRepo',null,'company_website','https://norepo-act.test',null);
  lead_match := public.closer_open_lead(c_match.id);
  lead_nomatch := public.closer_open_lead(c_nomatch.id);

  /* ---- the prospect's workspace, and an unrelated third --------------- */

  perform set_config('request.jwt.claims', json_build_object('sub',u_prospect,'role','authenticated')::text, true);
  org_prospect := (public.create_organization('Acme','act-acme-'||floor(random()*100000)::text)).id;
  perform set_config('request.jwt.claims', json_build_object('sub',u_outsider,'role','authenticated')::text, true);
  org_other := (public.create_organization('Other','act-other-'||floor(random()*100000)::text)).id;

  /*
   * Fixtures as owner: `closer_workspaces`,
   * `organization_github_installations` and `i18n_checks` each carry a select
   * policy and nothing else, so under RLS an insert is discarded without
   * raising. A fixture that silently writes nothing looks applied and reports
   * the wrong counts — the lesson `seeds/dev-user.sql` records.
   */
  perform set_config('role','postgres',true);
  insert into public.closer_workspaces (organization_id, note) values (org_op,'activation test');
  insert into public.organization_members (organization_id, user_id, role)
    values (org_op, u_member, 'member') on conflict do nothing;
  insert into public.organization_github_installations
    (organization_id, installation_id, account_login, account_type, connected_by, connected_at)
  values (org_prospect, 900001, 'AcmeCorp', 'Organization', u_prospect, '2026-10-01T10:00:00Z'),
         (org_other,    900002, 'Somebody', 'User',         u_outsider, '2026-10-01T10:00:00Z');

  -- Three checks, two distinct days, two pull requests, one repository. Shaped
  -- so every counter has a different expected value: a bug that returned the
  -- row count for all of them would pass if they all agreed.
  insert into public.i18n_checks
    (organization_id, repository_owner, repository_name, pull_number, head_sha,
     conclusion, title, summary, keys_checked, correction_applied, created_at)
  values
    (org_prospect,'acmecorp','web',1,'act-sha1','neutral','2 i18n problems','s',2,0,'2026-10-02T09:00:00Z'),
    (org_prospect,'acmecorp','web',1,'act-sha2','success','No i18n problems found','s',2,2,'2026-10-02T11:00:00Z'),
    (org_prospect,'acmecorp','web',2,'act-sha3','neutral','1 i18n problem','s',1,0,'2026-10-04T09:00:00Z');

  /* ---- authority ------------------------------------------------------ */
  --
  -- `member` is refused, not only the outsider. The functions read another
  -- tenant's rows, so the bar is owner or admin — and `org_role` returns NULL
  -- for a non-member, which is the NULL-in-`not in` defect `20260916000200`
  -- fixed in `link_github_installation`. Both cases are asserted.

  r := r || format('owner-may=%s(want t); ',
    public.closer_may_manage_activation(lead_match.id, u_op));
  r := r || format('member-may-not=%s(want f); ',
    public.closer_may_manage_activation(lead_match.id, u_member));
  r := r || format('outsider-may-not=%s(want f); ',
    public.closer_may_manage_activation(lead_match.id, u_outsider));
  r := r || format('null-user-may-not=%s(want f); ',
    public.closer_may_manage_activation(lead_match.id, null));

  /* ---- candidates ----------------------------------------------------- */

  select count(*) into n from public.closer_activation_candidates(lead_match.id, u_op);
  r := r || format('candidates=%s(want 1); ', n);

  select count(*) into n from public.closer_activation_candidates(lead_match.id, u_op)
   where organization_id = org_prospect;
  r := r || format('candidate-is-prospect=%s(want 1); ', n);

  /*
   * The self-link guard. Production holds exactly one organization — the
   * operator's, which carries both the installation and every check — so
   * without this an operator could link a lead to their own workspace and
   * watch every milestone light up from their own fixture testing. The most
   * convincing wrong answer this subsystem could give.
   */
  select count(*) into n from public.closer_activation_candidates(lead_match.id, u_op)
   where organization_id = org_op;
  r := r || format('self-link-excluded=%s(want 0); ', n);

  select count(*) into n from public.closer_activation_candidates(lead_nomatch.id, u_op);
  r := r || format('no-repository-no-candidates=%s(want 0); ', n);

  begin
    perform public.closer_activation_candidates(lead_match.id, u_outsider);
    r := r || 'candidates-refuse-outsider=f(want t); ';
  exception when others then
    r := r || 'candidates-refuse-outsider=t(want t); ';
  end;

  /* ---- the oracle test ------------------------------------------------ */
  --
  -- A real admin of a real Closer workspace naming a workspace they have no
  -- relationship with. The role check passes; the candidate check is what
  -- refuses. This is the assertion the whole design exists for.

  begin
    perform public.closer_link_activation(lead_match.id, org_other, u_op);
    r := r || 'noncandidate-link-refused=f(want t); ';
  exception when others then
    r := r || format('noncandidate-link-refused=%s(want t); ',
      sqlerrm like '%not a candidate%');
  end;

  begin
    perform public.closer_link_activation(lead_match.id, org_op, u_op);
    r := r || 'self-link-refused=f(want t); ';
  exception when others then
    r := r || 'self-link-refused=t(want t); ';
  end;

  begin
    perform public.closer_link_activation(lead_match.id, org_prospect, u_member);
    r := r || 'member-link-refused=f(want t); ';
  exception when others then
    r := r || 'member-link-refused=t(want t); ';
  end;

  /* ---- the real link -------------------------------------------------- */

  /*
   * No JWT for this call, which is what a service-role caller actually is.
   *
   * `closer_link_activation` and `closer_unlink_activation` are granted to
   * `service_role` only and take the acting user as a **parameter** precisely
   * because there is no session to read it from. This script was already in
   * the `postgres` role here, but `set_config(..., true)` is transaction-local
   * rather than role-local, so the subject set for an earlier assertion
   * survived the role switch — and the Closer write guard added in
   * `20261010000100_closer_operators.sql` reads `auth.uid()`, not the role. It
   * therefore saw a user with no grant and refused the `update` inside the
   * function.
   *
   * Production never reaches that state: `apps/web`'s admin client carries no
   * user JWT at all. So this is the script catching up with what it was always
   * modelling. `'{}'` rather than `''` — an empty string is not valid JSON and
   * `auth.uid()` casts before reading `sub`.
   */
  perform set_config('request.jwt.claims','{}',true);
  lead_match := public.closer_link_activation(lead_match.id, org_prospect, u_op);
  r := r || format('linked=%s(want t); ',
    lead_match.activated_organization_id = org_prospect);
  -- A link implies provenance: who decided this is the question an audit asks
  -- first, and a check constraint holds it rather than a convention.
  r := r || format('provenance-written=%s(want t); ',
    lead_match.activation_confirmed_by = u_op
    and lead_match.activation_confirmed_at is not null);

  begin
    perform set_config('role','postgres',true);
    update public.closer_leads
       set activated_organization_id = org_prospect,
           activation_confirmed_by = null,
           activation_confirmed_at = null
     where id = lead_nomatch.id;
    r := r || 'link-without-provenance-refused=f(want t); ';
  exception when others then
    r := r || 'link-without-provenance-refused=t(want t); ';
  end;
  perform set_config('role','postgres',true);

  -- One workspace, one lead. Two leads claiming it would report two design
  -- partners where there is one.
  select count(*) into n from public.closer_activation_candidates(lead_nomatch.id, u_op)
   where organization_id = org_prospect;
  r := r || format('claimed-org-not-offered-twice=%s(want 0); ', n);

  /* ---- the counters --------------------------------------------------- */

  select * into m from public.closer_activation_metrics(lead_match.id, u_op);
  r := r || format('installed-at=%s(want 2026-10-01); ',
    to_char(m.installed_at at time zone 'utc','YYYY-MM-DD'));
  -- `min(created_at)`, not `min(updated_at)`: a redelivery updates the row it
  -- already has, so `updated_at` would date the first check later than it was.
  r := r || format('first-check=%s(want 2026-10-02T09); ',
    to_char(m.first_check_at at time zone 'utc','YYYY-MM-DD"T"HH24'));
  r := r || format('last-check=%s(want 2026-10-04T09); ',
    to_char(m.last_check_at at time zone 'utc','YYYY-MM-DD"T"HH24'));
  r := r || format('checks=%s(want 3); days=%s(want 2); prs=%s(want 2); repos=%s(want 1); corrections=%s(want 2); ',
    m.checks_total, m.distinct_check_days, m.distinct_pull_requests,
    m.repositories_checked, m.corrections_applied);
  -- Modelled against the column a payment would write. Nothing writes it, so
  -- it is false for everybody — which `deriveActivation` reports as
  -- `not_derivable` rather than as a refusal to pay.
  r := r || format('paid=%s(want f); ', coalesce(m.has_paid_subscription, false));

  -- No link, no counters, and no row of zeroes: "zero checks" and "we have not
  -- matched this lead yet" are different facts.
  select count(*) into n from public.closer_activation_metrics(lead_nomatch.id, u_op);
  r := r || format('unlinked-metrics-empty=%s(want 0); ', n);

  begin
    perform public.closer_activation_metrics(lead_match.id, u_outsider);
    r := r || 'metrics-refuse-outsider=f(want t); ';
  exception when others then
    r := r || 'metrics-refuse-outsider=t(want t); ';
  end;

  /* ---- content never crosses the boundary ----------------------------- */
  --
  -- Read from `pg_proc.proargnames`, which is where a `returns table`
  -- function's columns actually live. The first version of this assertion
  -- queried `information_schema.columns` for a table named after the function
  -- — which does not exist, so it returned 0 and passed without inspecting
  -- anything. The counter count is asserted alongside so it cannot go vacuous
  -- again.

  select count(*) into n
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace,
         unnest(p.proargnames) nm
   where ns.nspname='public' and p.proname='closer_activation_metrics'
     and nm in ('repository_owner','repository_name','title','summary',
                'head_sha','locales_checked','pull_number','conclusion',
                'skipped_reason','correction_note','corrective_pr_url');
  r := r || format('metrics-content-columns=%s(want 0); ', n);

  select count(*) into n
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace,
         unnest(p.proargnames) nm
   where ns.nspname='public' and p.proname='closer_activation_metrics'
     and nm in ('checks_total','distinct_check_days','distinct_pull_requests',
                'repositories_checked','installed_at','first_check_at');
  r := r || format('metrics-counter-columns=%s(want 6); ', n);

  -- Nothing here is callable by a client. The authority lives in the function
  -- and the key lives in `apps/web`; a grant to `authenticated` would make
  -- every one of these an oracle reachable from a browser.
  select count(*) into n
    from information_schema.role_routine_grants
   where routine_schema='public'
     and routine_name in ('closer_may_manage_activation','closer_activation_candidates',
                          'closer_link_activation','closer_unlink_activation',
                          'closer_activation_metrics')
     and grantee in ('anon','authenticated');
  r := r || format('client-grants=%s(want 0); ', n);

  /* ---- and the ordinary isolation still holds ------------------------- */
  --
  -- The link does not widen what the operator can select. These two are the
  -- control: if either stopped returning 0, the cross-tenant read would have
  -- leaked out of the functions and into RLS.

  perform set_config('request.jwt.claims', json_build_object('sub',u_op,'role','authenticated')::text, true);
  perform set_config('role','authenticated',true);

  select count(*) into n from public.i18n_checks where organization_id = org_prospect;
  r := r || format('operator-direct-read-of-checks=%s(want 0); ', n);
  select count(*) into n from public.organization_github_installations
   where organization_id = org_prospect;
  r := r || format('operator-direct-read-of-install=%s(want 0); ', n);
  select count(*) into n from public.organizations where id = org_prospect;
  r := r || format('operator-direct-read-of-org=%s(want 0); ', n);

  -- And the prospect cannot reach the Closer at all.
  perform set_config('request.jwt.claims', json_build_object('sub',u_prospect,'role','authenticated')::text, true);
  select count(*) into n from public.closer_leads;
  r := r || format('prospect-sees-no-leads=%s(want 0); ', n);

  /* ---- unlink --------------------------------------------------------- */

  perform set_config('role','postgres',true);
  -- Same reason as the link above: the claim from the previous assertion is
  -- still set, and the write guard reads it.
  perform set_config('request.jwt.claims','{}',true);
  lead_match := public.closer_unlink_activation(lead_match.id, u_op);
  r := r || format('unlinked=%s(want t); provenance-cleared=%s(want t); ',
    lead_match.activated_organization_id is null,
    lead_match.activation_confirmed_by is null
    and lead_match.activation_confirmed_at is null);

  raise exception 'CLOSER-ACTIVATION >> %', r;
end $$;
