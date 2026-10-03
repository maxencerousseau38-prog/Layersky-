-- What a correction's model calls cost, recorded against the workspace.
--
-- `api_usage_daily` has always counted strings, requests and pull requests —
-- what was *asked for*, which is what a ceiling is enforced against. It has
-- never counted what any of it consumed, so every cost figure this product
-- could quote was a projection from `apps/api/eval`, measured on the legacy
-- pipeline and never reconciled against a workspace.
--
-- `record_model_usage` closes that, and this file pins the three properties a
-- price would be built on.
--
-- **A refusal is free, and that has to be true in the row and not only in the
-- caller.** The common delivery corrects nothing — a `placeholder-mismatch` is
-- always left for a person, and GitHub redelivers on every push — so the
-- cheapest outcome is the most frequent one. If it wrote a row claiming a
-- request, the average cost of a correction would be diluted by every delivery
-- that never reached a model.
--
-- **N keys across M locales lands on one row.** The guardrail sends one
-- request per locale, so a single correction is several calls; they are summed
-- against `(organization_id, usage_date)`, which is the key the ceiling
-- already uses. One workspace, one day, one row, whatever shape the work took.
--
-- **Recording a cost does not move the quota.** They answer different
-- questions and are charged at different moments — `consume_api_quota` before
-- the work, from a declared count; this after, from what the provider
-- reported. A write here that nudged `strings_translated` would charge twice
-- for one correction.
--
-- Like the other proofs here this ends in a deliberate RAISE: the transaction
-- rolls back, the database is left as it was found, and the verdict is read
-- out of the error message by supabase/tests/run.sh.
do $$
declare
  owner_id uuid := '77777777-7777-7777-7777-777777777777';
  org public.organizations;
  r record;
  n int; strings_before int; res text := '';
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
  values (owner_id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','usage@test.invalid','',now(),now())
  on conflict (id) do nothing;

  perform set_config('request.jwt.claims', json_build_object('sub',owner_id,'role','authenticated')::text, true);
  perform set_config('role','authenticated',true);
  org := public.create_organization('Usage','usage-org');
  perform set_config('role','postgres',true);

  -- Asserted first: a fresh workspace has no row, so every claim below is
  -- about something this function wrote rather than something already there.
  select count(*) into n from public.api_usage_daily
   where organization_id = org.id;
  res := res || format('fresh-rows=%s(want 0); ', n);

  -- A refusal reached no model. No row, not a row of zeroes: a row would make
  -- "this workspace spent nothing today" and "this workspace did nothing
  -- today" indistinguishable.
  perform public.record_model_usage(org.id, 'correction', 0, 0, 0, 0);
  select count(*) into n from public.api_usage_daily
   where organization_id = org.id;
  res := res || format('refusal-rows=%s(want 0); ', n);

  -- The row is created on first spend. `consume_api_quota` may have made it
  -- moments earlier or not at all, and a correction can be the first thing a
  -- workspace does on a given day.
  perform public.record_model_usage(org.id, 'correction', 6, 9762, 264, 0);
  select model_requests mr, input_tokens it, output_tokens ot, thinking_tokens tt,
         strings_translated st
    into r
    from public.api_usage_daily
   where organization_id = org.id and usage_date = (now() at time zone 'utc')::date;
  res := res || format('created-requests=%s(want 6); created-input=%s(want 9762); ', r.mr, r.it);
  strings_before := r.st;

  -- A second correction the same day adds to the same row rather than
  -- replacing it. One key into six languages then fourteen keys into one is
  -- seven calls, and the day's total is seven.
  perform public.record_model_usage(org.id, 'correction', 1, 2438, 1372, 267);
  select model_requests mr, input_tokens it, output_tokens ot, thinking_tokens tt,
         strings_translated st
    into r
    from public.api_usage_daily
   where organization_id = org.id and usage_date = (now() at time zone 'utc')::date;
  res := res || format('summed-requests=%s(want 7); summed-input=%s(want 12200); summed-output=%s(want 1636); ',
                       r.mr, r.it, r.ot);
  -- Thinking is a subset of output and is recorded beside it, not added to it.
  res := res || format('thinking=%s(want 267); thinking-within-output=%s(want t); ',
                       r.tt, r.tt <= r.ot);

  -- The ceiling is untouched. Cost and quota are two accounts of the same
  -- work, and only one of them may refuse the next request.
  res := res || format('quota-unmoved=%s(want t); ', r.st = strings_before);

  -- Negative input cannot drive a total backwards. Not a realistic provider
  -- reply; it is the shape a bug in the caller would take, and a tally that
  -- can go down is one that can be argued with.
  perform public.record_model_usage(org.id, 'correction', 1, -5000, -5000, -5000);
  select input_tokens it, model_requests mr into r
    from public.api_usage_daily
   where organization_id = org.id and usage_date = (now() at time zone 'utc')::date;
  res := res || format('floored-input=%s(want 12200); floored-requests=%s(want 8); ', r.it, r.mr);

  -- Service role only. The grant is narrow because this writes on behalf of a
  -- workspace from the webhook, and no session has any business adjusting what
  -- its own workspace is recorded as having spent.
  select count(*) into n
    from information_schema.role_routine_grants
   where routine_schema='public' and routine_name='record_model_usage'
     and grantee in ('anon','authenticated');
  res := res || format('client-grants=%s(want 0); ', n);

  raise exception 'MODEL-USAGE >> %', res;
end $$;
