-- Closer is for its designated operators, proved at the layer that enforces it.
--
-- `20261010000100_closer_operators.sql` replaced `is_org_member` with
-- `is_closer_operator` on twelve select policies and added a write trigger to
-- eleven tables. This is where that is checked, because the end-to-end suite
-- cannot reach it: the surface a member would have to use is precisely the one
-- that is no longer rendered, and the write path they could still have used is
-- a PostgREST call no browser test makes.
--
-- The fixtures are the development seed's: `acceptance` holds the
-- `closer_workspaces` row, an `owner` and a `member`, and `intruder-co` holds an
-- unrelated account. Nothing is invented — a proof that targets a slug nobody
-- created passes against an empty database, which this repository has paid for
-- before.
--
-- Like every file here it is not pgTAP: it ends in a deliberate `raise` that
-- rolls the transaction back, so it **exits in failure when it succeeds**, and
-- `run.sh` reads the verdict line to decide.

do $$
declare
  org uuid;
  owner_u uuid;
  member_u uuid;
  outsider_u uuid;
  n int;
  err text;
  r text := '';
begin
  select cw.organization_id into org from public.closer_workspaces cw limit 1;
  if org is null then
    raise exception 'CLOSER-OPERATORS >> fixture-missing=closer_workspaces(want a row)';
  end if;

  select m.user_id into owner_u from public.organization_members m
   where m.organization_id = org and m.role = 'owner' limit 1;
  select m.user_id into member_u from public.organization_members m
   where m.organization_id = org and m.role = 'member' limit 1;
  select u.id into outsider_u from auth.users u
   where u.id not in (select user_id from public.organization_members
                       where organization_id = org)
   limit 1;

  if owner_u is null or member_u is null or outsider_u is null then
    raise exception
      'CLOSER-OPERATORS >> fixture-missing=owner/member/outsider(want all three)';
  end if;

  /* ---------------- the bootstrap granted the owner, and only the owner ---- */

  select count(*) into n from public.closer_operators
   where organization_id = org and user_id = owner_u;
  r := r || format('owner-has-grant=%s(want 1); ', n);

  -- The whole point: membership is not authorisation.
  select count(*) into n from public.closer_operators
   where organization_id = org and user_id = member_u;
  r := r || format('member-has-grant=%s(want 0); ', n);

  /* ---------------- reads: the operator ----------------------------------- */

  perform set_config('request.jwt.claims',
    json_build_object('sub', owner_u, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);

  -- `hasCloser()` is this query. It must stay true for the operator, or the
  -- migration has locked the product's only user out of its own pipeline.
  select count(*) into n from public.closer_workspaces;
  r := r || format('operator-sees-workspace=%s(want 1); ', n);

  /*
   * A boolean, not the count. `run.sh` compares the two sides as exact strings,
   * so `(want >0)` would never agree with anything — the shape that makes a
   * check look present and prove nothing.
   */
  select count(*) into n from public.closer_leads;
  r := r || format('operator-sees-leads=%s(want true); ', (n > 0)::text);

  /* ---------------- reads: an ordinary member of the same workspace ------- */

  perform set_config('request.jwt.claims',
    json_build_object('sub', member_u, 'role', 'authenticated')::text, true);

  -- Each table separately, because one policy left on `is_org_member` would
  -- leak exactly one table and a single aggregate check would miss it.
  select count(*) into n from public.closer_workspaces;
  r := r || format('member-sees-workspace=%s(want 0); ', n);
  select count(*) into n from public.closer_leads;
  r := r || format('member-sees-leads=%s(want 0); ', n);
  select count(*) into n from public.closer_companies;
  r := r || format('member-sees-companies=%s(want 0); ', n);
  select count(*) into n from public.closer_contacts;
  r := r || format('member-sees-contacts=%s(want 0); ', n);
  select count(*) into n from public.closer_stage_history;
  r := r || format('member-sees-history=%s(want 0); ', n);
  select count(*) into n from public.closer_messages;
  r := r || format('member-sees-messages=%s(want 0); ', n);
  select count(*) into n from public.closer_replies;
  r := r || format('member-sees-replies=%s(want 0); ', n);
  select count(*) into n from public.closer_evidence;
  r := r || format('member-sees-evidence=%s(want 0); ', n);
  select count(*) into n from public.closer_scores;
  r := r || format('member-sees-scores=%s(want 0); ', n);
  select count(*) into n from public.closer_suppressions;
  r := r || format('member-sees-suppressions=%s(want 0); ', n);
  select count(*) into n from public.closer_jobs;
  r := r || format('member-sees-jobs=%s(want 0); ', n);
  select count(*) into n from public.closer_ai_executions;
  r := r || format('member-sees-ai-executions=%s(want 0); ', n);

  -- Their own grant row is visible and empty, which is the only thing
  -- `closer_operators_select_self` admits.
  select count(*) into n from public.closer_operators;
  r := r || format('member-sees-grants=%s(want 0); ', n);

  /* ---------------- the taxonomy stays readable --------------------------- */

  /*
   * Deliberately still `using (true)`. These hold which stages exist and which
   * transitions are legal — no company, contact or note — and
   * `packages/closer-core` ships the same taxonomy to the browser anyway.
   * Asserted so that "lock Closer down" never quietly breaks the enum lookups
   * the pipeline page needs.
   */
  select count(*) into n from public.closer_track_stages;
  r := r || format('member-sees-track-stages=%s(want true); ', (n > 0)::text);

  /* ---------------- writes: the security definer bypass ------------------- */

  /*
   * The half that matters most. Every `closer_*` write function is
   * `security definer`, so it bypasses RLS: before this migration a member who
   * could no longer *read* a lead could still have moved its stage over
   * PostgREST. The trigger is what closes that, and this proves it through a
   * real function rather than a direct insert a member could never have made.
   *
   * Both calls below are identical and both use a valid enum value, so a
   * refusal cannot come from argument parsing — an earlier version of this
   * proof passed an invalid `reason` and recorded a refusal that had nothing to
   * do with authorisation.
   */
  begin
    perform public.closer_suppress(
      org, 'member-probe.invalid', null,
      'operator_excluded'::public.closer_suppression_reason, 'authorisation proof');
    r := r || 'member-write=ALLOWED(want REFUSED); ';
    err := '';
  exception when others then
    r := r || 'member-write=REFUSED(want REFUSED); ';
    err := sqlerrm;
  end;

  -- And refused *by the guard*, named in its own words, not by chance.
  r := r || format('member-refused-by-guard=%s(want true); ',
                   (err like '%restricted to the operators%')::text);

  perform set_config('role', 'postgres', true);
  select count(*) into n from public.closer_suppressions
   where domain = 'member-probe.invalid';
  r := r || format('member-write-landed=%s(want 0); ', n);

  /* ---------------- the operator can still write -------------------------- */

  perform set_config('request.jwt.claims',
    json_build_object('sub', owner_u, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);

  begin
    perform public.closer_suppress(
      org, 'operator-probe.invalid', null,
      'operator_excluded'::public.closer_suppression_reason, 'authorisation proof');
    r := r || 'operator-write=ALLOWED(want ALLOWED); ';
  exception when others then
    r := r || format('operator-write=REFUSED:%s(want ALLOWED); ', sqlerrm);
  end;

  perform set_config('role', 'postgres', true);
  select count(*) into n from public.closer_suppressions
   where domain = 'operator-probe.invalid';
  r := r || format('operator-write-landed=%s(want 1); ', n);

  /* ---------------- an outsider ------------------------------------------- */

  perform set_config('request.jwt.claims',
    json_build_object('sub', outsider_u, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);

  select count(*) into n from public.closer_leads;
  r := r || format('outsider-sees-leads=%s(want 0); ', n);
  select count(*) into n from public.closer_workspaces;
  r := r || format('outsider-sees-workspace=%s(want 0); ', n);

  /* ---------------- a grant without membership is not enough -------------- */

  /*
   * `is_closer_operator` requires both. This proves the second half: strip the
   * owner's membership, leave their grant intact, and access goes. Otherwise a
   * grant row would outlive the relationship it was issued for — somebody
   * removed from the workspace would keep reading its pipeline.
   */
  perform set_config('role', 'postgres', true);
  delete from public.organization_members
   where organization_id = org and user_id = owner_u;

  perform set_config('request.jwt.claims',
    json_build_object('sub', owner_u, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);

  select count(*) into n from public.closer_leads;
  r := r || format('ex-member-with-grant-sees-leads=%s(want 0); ', n);

  perform set_config('role', 'postgres', true);

  /* ---------------- anon reaches nothing ---------------------------------- */

  /*
   * `revoke ... from public, anon` and not only `from public`: Supabase grants
   * `anon` directly, so revoking from PUBLIC alone leaves it. A migration in
   * this repository shipped with exactly that hole and `get_advisors` found it.
   */
  r := r || format('anon-may-exec-predicate=%s(want false); ',
    has_function_privilege('anon', 'public.is_closer_operator(uuid)', 'EXECUTE')::text);
  r := r || format('anon-may-read-grants=%s(want false); ',
    has_table_privilege('anon', 'public.closer_operators', 'SELECT')::text);

  /*
   * The write guard is callable by nobody directly.
   *
   * `get_advisors` flagged this on the first run after the function was
   * written: it was reachable at `/rest/v1/rpc/closer_require_operator` as
   * `anon`, because the migration revoked for `is_closer_operator` and forgot
   * this one. Not exploitable — a trigger function called outside a trigger
   * raises — but the hole is the kind this schema refuses to leave open.
   *
   * `authenticated` is revoked too, and the triggers still fire: PostgreSQL
   * does not check EXECUTE on a trigger function when firing a trigger. That
   * was measured, not assumed.
   */
  r := r || format('anon-may-exec-write-guard=%s(want false); ',
    has_function_privilege('anon', 'public.closer_require_operator()', 'EXECUTE')::text);
  r := r || format('authenticated-may-exec-write-guard=%s(want false); ',
    has_function_privilege('authenticated', 'public.closer_require_operator()', 'EXECUTE')::text);

  raise exception 'CLOSER-OPERATORS >> %', r;
end $$;
