-- Loss reasons: required where they mean something, impossible where they do not.
--
-- Three different guards are proved here, and the point of separating them is
-- that they fail differently:
--
--   the **function** raises a sentence when a required reason is missing;
--   the **foreign key** refuses a reason that does not fit its exit stage, for
--   every writer including one that goes round the function;
--   the **check constraint** refuses a reason on a transition that is not an
--   exit at all.
--
-- So the last two are exercised twice: once through `closer_set_stage`, where
-- an operator gets a readable error, and once by inserting into
-- `closer_stage_history` directly as `postgres` — because a guard that only
-- holds when called politely is a convention, not a constraint.
--
-- **The overload assertions are not ceremony.** `closer_set_stage` gains a
-- fourth argument here, and `create or replace` with a new signature does not
-- replace: it adds an overload, leaving the old function in place without the
-- new guard. That is a defect this repository has actually shipped — see the
-- header of `closer-track.sql` — so the drop is explicit and the count is
-- pinned, along with the three guards that had to survive being retyped.
--
-- Like the other proofs here this ends in a deliberate RAISE: the transaction
-- rolls back, the database is left as it was found, and the verdict is read out
-- of the error message by supabase/tests/run.sh.
do $$
declare
  owner_id uuid := '77777777-7777-7777-7777-777777777777';
  intruder_id uuid := '77777777-7777-7777-7777-777777777776';
  org public.organizations;
  other public.organizations;
  lead_installed public.closer_leads;
  lead_checked public.closer_leads;
  lead_contacted public.closer_leads;
  lead_qualified public.closer_leads;
  lead_postponed public.closer_leads;
  lead_sales public.closer_leads;
  lead_suppressed public.closer_leads;
  lead_fresh public.closer_leads;
  res text := '';
  n int;
  txt text;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
  values
    (owner_id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','losses@test.invalid','',now(),now()),
    (intruder_id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','losses-b@test.invalid','',now(),now())
  on conflict (id) do nothing;

  /* ------------------------------------------------------------------ *
   * Schema: the taxonomy, the pair table, and the writer's shape
   * ------------------------------------------------------------------ */

  select count(*) into n from pg_enum e
    join pg_type t on t.oid = e.enumtypid
   where t.typname = 'closer_loss_reason';
  res := res || format('enum-values=%s(want 9); ', n);

  -- The exact list, in order, against the one `losses.ts` mirrors.
  select string_agg(e.enumlabel::text, ',' order by e.enumsortorder) into txt
    from pg_enum e join pg_type t on t.oid = e.enumtypid
   where t.typname = 'closer_loss_reason';
  res := res || format('enum-order=%s(want has_tms,no_multilingual_need,wrong_framework,no_reply,timing,price,installed_never_used,check_was_noisy,other); ', txt);

  /*
   * The generated pair table, counted exactly. 25 stages less the 5 terminals
   * leaves 20 exit stages; seven reasons apply to all of them, and the two
   * post-install reasons apply to 5 and 4. 7*20 + 5 + 4 = 149.
   *
   * A count rather than a spot check, because the generation is a cross join
   * with two exclusions and the way it goes wrong is by excluding too much.
   */
  select count(*) into n from public.closer_loss_reason_stages;
  res := res || format('pair-rows=%s(want 149); ', n);

  select count(*) into n from public.closer_loss_reason_stages
   where loss_reason = 'installed_never_used';
  res := res || format('never-used-stages=%s(want 5); ', n);

  select count(*) into n from public.closer_loss_reason_stages
   where loss_reason = 'check_was_noisy';
  res := res || format('noisy-stages=%s(want 4); ', n);

  -- A lead that has already left has no exit stage to leave from.
  select count(*) into n from public.closer_loss_reason_stages
   where exit_stage = any (array['not_a_fit','not_now','unresponsive','lost','do_not_contact']::public.closer_stage[]);
  res := res || format('terminal-exit-stages=%s(want 0); ', n);

  -- One function, not two. The lesson of 20261004000200.
  select count(*) into n from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'closer_set_stage';
  res := res || format('set-stage-overloads=%s(want 1); ', n);

  select p.pronargs into n from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'closer_set_stage';
  res := res || format('set-stage-args=%s(want 4); ', n);

  -- The three guards that had to survive being retyped into the new body.
  select count(*) into n from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'closer_set_stage'
     and position('p_actor' in pg_get_functiondef(p.oid)) > 0;
  res := res || format('set-stage-takes-actor=%s(want 0); ', n);

  select count(*) into n from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'closer_set_stage'
     and position('closer_track_stages' in pg_get_functiondef(p.oid)) > 0;
  res := res || format('set-stage-checks-track=%s(want 1); ', n);

  select count(*) into n from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'closer_set_stage'
     and position('trim(p_reason)' in pg_get_functiondef(p.oid)) > 0;
  res := res || format('set-stage-trims-reason=%s(want 1); ', n);

  select count(*) into n from pg_constraint
   where conname = 'closer_stage_history_loss_reason_fits_exit_stage' and contype = 'f';
  res := res || format('history-pair-fk=%s(want 1); ', n);

  /*
   * The view reads as the caller, not as its owner. Without this it would be a
   * definer-shaped read of every workspace's losses wearing the shape of a
   * view — the hole `closer_is_suppressed` had, arriving by another door.
   */
  select coalesce('security_invoker=true' = any (c.reloptions), false)::text
    into txt
    from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
   where ns.nspname = 'public' and c.relname = 'closer_losses';
  res := res || format('view-security-invoker=%s(want true); ', txt);

  select count(*) into n from information_schema.role_table_grants
   where table_schema='public' and table_name='closer_loss_reason_stages' and grantee='anon';
  res := res || format('anon-pair-grants=%s(want 0); ', n);

  /* ------------------------------------------------------------------ *
   * Fixtures
   * ------------------------------------------------------------------ */

  perform set_config('request.jwt.claims', json_build_object('sub',owner_id,'role','authenticated')::text, true);
  perform set_config('role','authenticated',true);

  org := public.create_organization('Losses','losses-proof');

  lead_installed  := public.closer_open_lead((public.closer_upsert_company(org.id,'A1','a1-loss.test','github_repository','https://github.com/a/1','a/1')).id);
  lead_checked    := public.closer_open_lead((public.closer_upsert_company(org.id,'A2','a2-loss.test','github_repository','https://github.com/a/2','a/2')).id);
  lead_contacted  := public.closer_open_lead((public.closer_upsert_company(org.id,'A3','a3-loss.test','github_repository','https://github.com/a/3','a/3')).id);
  lead_qualified  := public.closer_open_lead((public.closer_upsert_company(org.id,'A4','a4-loss.test','github_repository','https://github.com/a/4','a/4')).id);
  lead_postponed  := public.closer_open_lead((public.closer_upsert_company(org.id,'A5','a5-loss.test','github_repository','https://github.com/a/5','a/5')).id);
  lead_sales      := public.closer_open_lead((public.closer_upsert_company(org.id,'A6','a6-loss.test','github_repository','https://github.com/a/6','a/6')).id);
  lead_suppressed := public.closer_open_lead((public.closer_upsert_company(org.id,'A7','a7-loss.test','github_repository','https://github.com/a/7','a/7')).id);
  lead_fresh      := public.closer_open_lead((public.closer_upsert_company(org.id,'A8','a8-loss.test','github_repository','https://github.com/a/8','a/8')).id);

  -- One lead on the original motion, to show the sales funnel is untouched.
  perform set_config('role','postgres',true);
  update public.closer_leads set track='sales' where id = lead_sales.id;
  perform set_config('role','authenticated',true);

  -- Up to `interested`, which both motions share.
  lead_installed := public.closer_set_stage(lead_installed.id,'qualified','signals');
  lead_installed := public.closer_set_stage(lead_installed.id,'researched','brief');
  lead_installed := public.closer_set_stage(lead_installed.id,'ready_for_outreach','angle');
  lead_installed := public.closer_set_stage(lead_installed.id,'outreach_approved','approved');
  lead_installed := public.closer_set_stage(lead_installed.id,'contacted','sent');
  lead_installed := public.closer_set_stage(lead_installed.id,'replied','answered');
  lead_installed := public.closer_set_stage(lead_installed.id,'interested','positive');
  lead_installed := public.closer_set_stage(lead_installed.id,'installed','connected the App');
  res := res || format('reached-installed=%s(want installed); ', lead_installed.stage);

  lead_checked := public.closer_set_stage(lead_checked.id,'qualified','signals');
  lead_checked := public.closer_set_stage(lead_checked.id,'researched','brief');
  lead_checked := public.closer_set_stage(lead_checked.id,'ready_for_outreach','angle');
  lead_checked := public.closer_set_stage(lead_checked.id,'outreach_approved','approved');
  lead_checked := public.closer_set_stage(lead_checked.id,'contacted','sent');
  lead_checked := public.closer_set_stage(lead_checked.id,'replied','answered');
  lead_checked := public.closer_set_stage(lead_checked.id,'interested','positive');
  lead_checked := public.closer_set_stage(lead_checked.id,'installed','connected the App');
  lead_checked := public.closer_set_stage(lead_checked.id,'first_check','a check ran');

  lead_contacted := public.closer_set_stage(lead_contacted.id,'qualified','signals');
  lead_contacted := public.closer_set_stage(lead_contacted.id,'researched','brief');
  lead_contacted := public.closer_set_stage(lead_contacted.id,'ready_for_outreach','angle');
  lead_contacted := public.closer_set_stage(lead_contacted.id,'outreach_approved','approved');
  lead_contacted := public.closer_set_stage(lead_contacted.id,'contacted','sent');

  lead_postponed := public.closer_set_stage(lead_postponed.id,'qualified','signals');
  lead_postponed := public.closer_set_stage(lead_postponed.id,'researched','brief');
  lead_postponed := public.closer_set_stage(lead_postponed.id,'ready_for_outreach','angle');
  lead_postponed := public.closer_set_stage(lead_postponed.id,'outreach_approved','approved');
  lead_postponed := public.closer_set_stage(lead_postponed.id,'contacted','sent');

  lead_qualified := public.closer_set_stage(lead_qualified.id,'qualified','signals');

  lead_sales := public.closer_set_stage(lead_sales.id,'researching','research');
  lead_sales := public.closer_set_stage(lead_sales.id,'qualified','fit');
  lead_sales := public.closer_set_stage(lead_sales.id,'ready_for_outreach','angle');
  lead_sales := public.closer_set_stage(lead_sales.id,'outreach_approved','approved');
  lead_sales := public.closer_set_stage(lead_sales.id,'contacted','sent');
  lead_sales := public.closer_set_stage(lead_sales.id,'replied','answered');
  lead_sales := public.closer_set_stage(lead_sales.id,'interested','positive');

  /* ------------------------------------------------------------------ *
   * A reason is required on the three terminals that mean a loss
   * ------------------------------------------------------------------ */

  begin
    perform public.closer_set_stage(lead_installed.id,'lost','gave up');
    res := res || 'lost-needs-reason=f(want t); ';
  exception when others then
    res := res || format('lost-needs-reason=%s(want t); ',
      sqlerrm like '%needs a loss reason%');
  end;

  begin
    perform public.closer_set_stage(lead_qualified.id,'not_a_fit','no');
    res := res || 'not-a-fit-needs-reason=f(want t); ';
  exception when others then
    res := res || format('not-a-fit-needs-reason=%s(want t); ',
      sqlerrm like '%needs a loss reason%');
  end;

  begin
    perform public.closer_set_stage(lead_contacted.id,'unresponsive','silence');
    res := res || 'unresponsive-needs-reason=f(want t); ';
  exception when others then
    res := res || format('unresponsive-needs-reason=%s(want t); ',
      sqlerrm like '%needs a loss reason%');
  end;

  /*
   * And is **not** required on the other two. `not_now` can re-enter the
   * funnel, so it records a postponement; it would otherwise be a mandatory
   * field with one possible answer.
   */
  lead_postponed := public.closer_set_stage(lead_postponed.id,'not_now','asked for Q3');
  res := res || format('not-now-without-reason=%s(want not_now); ', lead_postponed.stage);

  /*
   * The regression that matters most in this file. `closer_suppress` moves
   * every lead an identifier reaches by calling `closer_set_stage` with no loss
   * reason — so requiring one on `do_not_contact` would make an opt-out raise.
   */
  perform public.closer_suppress(org.id,'a7-loss.test',null,'opted_out','asked to stop');
  select stage::text into txt from public.closer_leads where id = lead_suppressed.id;
  res := res || format('suppression-still-works=%s(want do_not_contact); ', txt);

  /* ------------------------------------------------------------------ *
   * installed → lost with installed_never_used: the named requirement
   * ------------------------------------------------------------------ */

  select count(*) into n from public.closer_stage_transitions
   where from_stage='installed' and to_stage='lost';
  res := res || format('installed-lost-edge-exists=%s(want 1); ', n);

  select count(*) into n from public.closer_loss_reason_stages
   where loss_reason='installed_never_used' and exit_stage='installed';
  res := res || format('never-used-allowed-at-installed=%s(want 1); ', n);

  lead_installed := public.closer_set_stage(
    lead_installed.id,'lost','connected it and nothing ever ran','installed_never_used');
  res := res || format('installed-lost-accepted=%s(want lost); ', lead_installed.stage);

  /*
   * The exit stage is read from the row, not supplied. `from_stage` on the
   * history row is `installed` because that is where the lead was — there is no
   * second column for a caller to disagree with.
   */
  select format('%s/%s', from_stage, loss_reason) into txt
    from public.closer_stage_history
   where lead_id = lead_installed.id and loss_reason is not null;
  res := res || format('history-exit-and-reason=%s(want installed/installed_never_used); ', txt);

  select exit_stage::text into txt from public.closer_losses
   where lead_id = lead_installed.id;
  res := res || format('view-exit-stage=%s(want installed); ', txt);

  /* ------------------------------------------------------------------ *
   * The two impossible pairs
   * ------------------------------------------------------------------ */

  /*
   * `installed` means the App is connected and nothing has run, so the
   * prospect has not seen a check to find noisy. The edge is asserted present
   * first: without that this would pass on a missing transition and prove
   * nothing, which is how the first draft of closer-track.sql fooled itself.
   */
  select count(*) into n from public.closer_stage_transitions
   where from_stage='first_check' and to_stage='lost';
  res := res || format('first-check-lost-edge-exists=%s(want 1); ', n);

  -- Allowed once a check has actually run.
  lead_checked := public.closer_set_stage(
    lead_checked.id,'lost','too many findings they did not want','check_was_noisy');
  res := res || format('noisy-allowed-after-check=%s(want lost); ', lead_checked.stage);

  -- And refused from a stage where no check could have run.
  begin
    perform public.closer_set_stage(
      lead_qualified.id,'not_a_fit','no','check_was_noisy');
    res := res || 'noisy-refused-before-check=f(want t); ';
  exception when others then
    res := res || format('noisy-refused-before-check=%s(want t); ',
      sqlerrm like '%is not a reason a lead can be lost for at qualified%');
  end;

  -- Nor can a lead that never installed have installed and not used it.
  begin
    perform public.closer_set_stage(
      lead_contacted.id,'unresponsive','silence','installed_never_used');
    res := res || 'never-used-refused-before-install=f(want t); ';
  exception when others then
    res := res || format('never-used-refused-before-install=%s(want t); ',
      sqlerrm like '%is not a reason a lead can be lost for at contacted%');
  end;

  -- A real reason for that lead, to leave it terminal.
  lead_contacted := public.closer_set_stage(
    lead_contacted.id,'unresponsive','no answer after the follow-up','no_reply');
  res := res || format('unresponsive-with-reason=%s(want unresponsive); ', lead_contacted.stage);

  /* ------------------------------------------------------------------ *
   * A reason only ever describes an exit
   * ------------------------------------------------------------------ */

  begin
    perform public.closer_set_stage(
      lead_fresh.id,'qualified','signals','price');
    res := res || 'reason-refused-on-active-stage=f(want t); ';
  exception when others then
    res := res || format('reason-refused-on-active-stage=%s(want t); ',
      sqlerrm like '%is not a stage a lead is lost at%');
  end;

  /* ------------------------------------------------------------------ *
   * The sales funnel, untouched
   * ------------------------------------------------------------------ */

  lead_sales := public.closer_set_stage(
    lead_sales.id,'lost','the number was the obstacle','price');
  res := res || format('sales-lost-with-reason=%s(want lost); ', lead_sales.stage);

  /*
   * Exactly four losses were recorded, and every other move in this workspace
   * carries no reason at all. A count of the nulls would have been satisfied
   * by almost anything; a count of the rows that *do* carry one is the number
   * this file can be wrong about.
   */
  select count(*) into n from public.closer_stage_history
   where organization_id = org.id and loss_reason is not null;
  res := res || format('losses-recorded=%s(want 4); ', n);

  select count(*) into n from public.closer_stage_history
   where organization_id = org.id
     and loss_reason is not null
     and to_stage <> all (array['not_a_fit','not_now','unresponsive','lost','do_not_contact']::public.closer_stage[]);
  res := res || format('reasons-outside-an-exit=%s(want 0); ', n);

  /* ------------------------------------------------------------------ *
   * Structural, not merely polite: go round the function
   * ------------------------------------------------------------------ */

  perform set_config('role','postgres',true);

  -- A pair the taxonomy does not allow, inserted by the owner of the table.
  begin
    insert into public.closer_stage_history
      (organization_id, lead_id, from_stage, to_stage, actor, reason, loss_reason)
    values (org.id, lead_fresh.id, 'contacted', 'lost', null, 'forged', 'check_was_noisy');
    res := res || 'fk-refuses-bad-pair=f(want t); ';
  exception when foreign_key_violation then
    res := res || 'fk-refuses-bad-pair=t(want t); ';
  end;

  -- A reason on a transition that is not an exit.
  begin
    insert into public.closer_stage_history
      (organization_id, lead_id, from_stage, to_stage, actor, reason, loss_reason)
    values (org.id, lead_fresh.id, 'discovered', 'qualified', null, 'forged', 'price');
    res := res || 'check-refuses-non-exit=f(want t); ';
  exception when check_violation then
    res := res || 'check-refuses-non-exit=t(want t); ';
  end;

  -- An allowed pair on a real exit still goes in, so the two above refused for
  -- their own reasons rather than because the insert was broken.
  insert into public.closer_stage_history
    (organization_id, lead_id, from_stage, to_stage, actor, reason, loss_reason)
  values (org.id, lead_fresh.id, 'contacted', 'lost', null, 'direct but valid', 'timing');
  res := res || 'valid-pair-inserts=t(want t); ';

  /* ------------------------------------------------------------------ *
   * Isolation
   * ------------------------------------------------------------------ */

  perform set_config('request.jwt.claims', json_build_object('sub',intruder_id,'role','authenticated')::text, true);
  perform set_config('role','authenticated',true);
  other := public.create_organization('Intruder','losses-intruder');

  select count(*) into n from public.closer_losses where organization_id = org.id;
  res := res || format('b-sees-a-losses=%s(want 0); ', n);

  select count(*) into n from public.closer_stage_history where organization_id = org.id;
  res := res || format('b-sees-a-history=%s(want 0); ', n);

  begin
    perform public.closer_set_stage(lead_fresh.id,'not_a_fit','not mine','has_tms');
    res := res || 'b-cannot-lose-a-lead=f(want t); ';
  exception when others then
    res := res || format('b-cannot-lose-a-lead=%s(want t); ',
      sqlerrm like '%not a member of this workspace%');
  end;

  -- Reference data is shared on purpose; a form needs it to offer reasons.
  select count(*) into n from public.closer_loss_reason_stages;
  res := res || format('b-reads-taxonomy=%s(want 149); ', n);

  perform set_config('role','postgres',true);
  raise exception 'CLOSER-LOSSES >> %', res;
end $$;
