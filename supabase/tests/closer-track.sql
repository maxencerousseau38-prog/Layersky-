-- The design-partner track: a lead cannot wander onto the other motion.
--
-- `closer_stage_transitions` says which moves are *structurally* possible and
-- `closer_track_stages` says which stages a motion owns. A move needs both.
-- This file exists because the interesting case is the one where they
-- disagree: an edge that really is in the graph, to a stage that belongs to
-- the other funnel.
--
-- **Three arguments, not four.** `closer_set_stage` took a caller-supplied
-- actor until `20260825000300` found it forgeable, dropped it and replaced
-- it with a three-argument function that reads `auth.uid()` itself. This
-- file calls the three-argument form because that is the one that exists and
-- the one both callers in `apps/web` use — a proof against a signature
-- nobody calls would prove nothing about the product.
--
-- **The first version of this proof was vacuous and said so.** It tried
-- `researched → researching`, which has no edge at all — so the refusal came
-- from the edge check and the assertion passed without the track table being
-- consulted. `interested → qualified_opportunity` is the real case: the edge
-- is in the forward sales chain, `interested` is shared by both motions, and
-- the destination is sales-only. The edge count is asserted first, so this
-- cannot silently become vacuous again.
--
-- Like the other proofs here this ends in a deliberate RAISE: the transaction
-- rolls back, the database is left as it was found, and the verdict is read
-- out of the error message by supabase/tests/run.sh.
do $$
declare
  owner_id uuid := '99999999-9999-9999-9999-999999999999';
  org public.organizations;
  c1 public.closer_companies;
  c2 public.closer_companies;
  dp public.closer_leads;
  sales public.closer_leads;
  res text := '';
  n int;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
  values (owner_id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','dp@test.invalid','',now(),now())
  on conflict (id) do nothing;

  perform set_config('request.jwt.claims', json_build_object('sub',owner_id,'role','authenticated')::text, true);
  perform set_config('role','authenticated',true);

  org := public.create_organization('DP track','dp-track');
  c1 := public.closer_upsert_company(org.id,'Acme','acme-dp.test','github_repository','https://github.com/a/b','a/b');
  c2 := public.closer_upsert_company(org.id,'Beta','beta-dp.test','github_repository','https://github.com/c/d','c/d');
  dp := public.closer_open_lead(c1.id);
  sales := public.closer_open_lead(c2.id);

  -- A new lead joins the motion this product is running now. Existing rows
  -- were backfilled to `sales`; the default describes today.
  res := res || format('default-track=%s(want design_partner); ', dp.track);
  res := res || format('starts-at=%s(want discovered); ', dp.stage);

  perform set_config('role','postgres',true);
  update public.closer_leads set track='sales' where id=sales.id;
  perform set_config('role','authenticated',true);

  /*
   * The order reversal that is the point of the new track.
   *
   * Sales researches then qualifies. Design-partner acquisition qualifies on
   * cheap public signals and only then spends the research, because research
   * costs API calls and attention and most candidates fail on a dependency
   * list. Both orders are walked here, on the same database, to show the two
   * graphs coexist rather than one having replaced the other.
   */
  dp := public.closer_set_stage(dp.id,'qualified','signals support a fit');
  dp := public.closer_set_stage(dp.id,'researched','brief written');
  res := res || format('dp-qualifies-first=%s(want researched); ', dp.stage);

  sales := public.closer_set_stage(sales.id,'researching','research');
  sales := public.closer_set_stage(sales.id,'qualified','fit');
  res := res || format('sales-researches-first=%s(want qualified); ', sales.stage);

  -- Both to `interested`, which the two motions share.
  dp := public.closer_set_stage(dp.id,'ready_for_outreach','angle holds');
  dp := public.closer_set_stage(dp.id,'outreach_approved','a person approved');
  dp := public.closer_set_stage(dp.id,'contacted','sent by hand');
  dp := public.closer_set_stage(dp.id,'replied','they answered');
  dp := public.closer_set_stage(dp.id,'interested','positive');

  sales := public.closer_set_stage(sales.id,'ready_for_outreach','angle holds');
  sales := public.closer_set_stage(sales.id,'outreach_approved','a person approved');
  sales := public.closer_set_stage(sales.id,'contacted','sent by hand');
  sales := public.closer_set_stage(sales.id,'replied','they answered');
  sales := public.closer_set_stage(sales.id,'interested','positive');

  /*
   * The case the track table exists for, in both directions.
   *
   * The edge count is asserted before the refusal. Without it a future change
   * that deleted the edge would make this pass for the wrong reason, which is
   * exactly how the first draft of this file fooled itself.
   */
  select count(*) into n from public.closer_stage_transitions
   where from_stage='interested' and to_stage='qualified_opportunity';
  res := res || format('sales-edge-exists=%s(want 1); ', n);
  begin
    perform public.closer_set_stage(dp.id,'qualified_opportunity','wander');
    res := res || 'dp-blocked-from-sales=f(want t); ';
  exception when others then
    res := res || format('dp-blocked-from-sales=%s(want t); ',
      sqlerrm like '%is not a stage on the design_partner track%');
  end;

  select count(*) into n from public.closer_stage_transitions
   where from_stage='interested' and to_stage='installed';
  res := res || format('activation-edge-exists=%s(want 1); ', n);
  begin
    perform public.closer_set_stage(sales.id,'installed','wander');
    res := res || 'sales-blocked-from-dp=f(want t); ';
  exception when others then
    res := res || format('sales-blocked-from-dp=%s(want t); ',
      sqlerrm like '%is not a stage on the sales track%');
  end;

  -- Neither refusal cost either lead its own path.
  dp := public.closer_set_stage(dp.id,'installed','App connected');
  sales := public.closer_set_stage(sales.id,'qualified_opportunity','budget');
  res := res || format('dp-own-path=%s(want installed); ', dp.stage);
  res := res || format('sales-own-path=%s(want qualified_opportunity); ', sales.stage);

  /*
   * `installed → lost` is the most informative failure this funnel records:
   * it says the problem was not reach, not the pitch and not the price. The
   * original migration generated its terminal edges from `enum_range` before
   * these stages existed, so every one of them had to be written out by hand
   * — and a missing one would leave a lead stuck at `installed` forever while
   * the funnel reported it as progress.
   */
  dp := public.closer_set_stage(dp.id,'lost','installed and never ran a check');
  res := res || format('installed-to-lost=%s(want lost); ', dp.stage);

  -- Every one of the six new stages can reach the absorbing state.
  select count(*) into n from public.closer_stage_transitions
   where to_stage='do_not_contact'
     and from_stage in ('researched','installed','first_check','repeated_usage','pricing','paid');
  res := res || format('new-stages-suppressible=%s(want 6); ', n);

  -- The shape of the funnel is readable by a member and writable by nobody:
  -- the default Supabase grants include INSERT, and RLS is what refuses it.
  select count(*) into n from public.closer_track_stages;
  res := res || format('track-readable=%s(want t); ', n > 0);
  begin
    insert into public.closer_track_stages (track, stage) values ('sales','paid');
    res := res || 'track-writable=t(want f); ';
  exception when others then
    res := res || 'track-writable=f(want f); ';
  end;

  /*
   * One history row per move, plus the one `closer_open_lead` writes when a
   * lead enters the world at `discovered`. Ten for nine transitions — and the
   * two refused moves left nothing behind, which is the half of the count
   * that matters.
   */
  /*
   * Exactly one writer, taking no actor from the caller.
   *
   * This migration's first draft reproduced the superseded four-argument body
   * and `create or replace` added it as a *second overload* — bringing back
   * the forgeable-actor version `20260825000300` deleted, while both callers
   * in `apps/web` kept resolving to the three-argument one without the track
   * check. Two overloads is the symptom; this is the assertion that names it.
   */
  select count(*) into n from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname='public' and p.proname='closer_set_stage';
  res := res || format('set-stage-overloads=%s(want 1); ', n);

  select count(*) into n from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname='public' and p.proname='closer_set_stage'
     and position('p_actor' in pg_get_functiondef(p.oid)) > 0;
  res := res || format('set-stage-takes-actor=%s(want 0); ', n);

  select count(*) into n from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname='public' and p.proname='closer_set_stage'
     and position('closer_track_stages' in pg_get_functiondef(p.oid)) > 0;
  res := res || format('set-stage-checks-track=%s(want 1); ', n);

  -- The actor on every row is the signed-in caller, read by the function
  -- rather than passed to it.
  select count(*) into n from public.closer_stage_history
   where lead_id = dp.id and actor is distinct from owner_id;
  res := res || format('history-actor-not-caller-supplied=%s(want 0); ', n);

  select count(*) into n from public.closer_stage_history where lead_id = dp.id;
  res := res || format('dp-history-rows=%s(want 10); ', n);

  perform set_config('role','postgres',true);
  raise exception 'CLOSER-TRACK >> %', res;
end $$;
