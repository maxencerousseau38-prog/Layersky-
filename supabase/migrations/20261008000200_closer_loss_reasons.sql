-- Why a design partner was lost, as a value the database checks.
--
-- ## The question this answers
--
-- A funnel that records only *where* leads stop tells you the shape of the
-- loss and nothing about its cause. Five leads lost at `installed` could be
-- five teams who found the check noisy, or five teams who never wired it to a
-- pull request, and those have opposite remedies: one is a product defect, the
-- other is onboarding. `reason text` already existed and could hold either
-- sentence, which is precisely why it cannot be counted.
--
-- ## Two fields, because they answer two different questions
--
-- **`exit_stage` is not a new column.** `closer_stage_history.from_stage` is
-- already the stage a lead left, written by the only function that can move a
-- lead, in the same statement as the move. Adding `closer_leads.exit_stage`
-- would be a second account of a fact this table already holds — free to
-- disagree with it, and the first symptom would be a funnel reporting an exit
-- from a stage the history says the lead was never in. The same reasoning
-- keeps `lib/onboarding/steps.ts` stateless and makes `/[org]/usage` read
-- `api_usage_daily` instead of recounting from `runs`.
--
-- So the separation the brief asks for is a separation of *meaning*, and
-- `closer_losses` below gives it a name: `exit_stage` (where) beside
-- `loss_reason` (why), from one row, with no way for them to drift.
--
-- ## Where each rule is enforced, and why it is not all in one place
--
-- Three different guards, deliberately:
--
-- 1. **A reason must be one that fits the stage it was given from** — a
--    composite foreign key to `closer_loss_reason_stages`. Structural, so it
--    holds against every writer including `service_role`. A composite FK with
--    a NULL column is satisfied by default under MATCH SIMPLE, which is
--    exactly the behaviour wanted: rows without a loss reason are not checked.
-- 2. **A reason may only appear on a transition into a terminal stage** — a
--    table CHECK. Every existing row has `loss_reason` null, so it is true of
--    the history as it stands.
-- 3. **Some terminals *require* a reason** — in `closer_set_stage`, not in a
--    CHECK. A CHECK would retroactively invalidate every `lost` row already
--    recorded, and the brief says preserve the existing history. The function
--    is the only writer with an insert path — `closer_stage_history` has a
--    select policy and no insert policy — so for anything short of the service
--    key this is enforcement, not convention.
--
-- ## Nothing is backfilled
--
-- Existing history keeps `loss_reason = null`. Nobody recorded a reason for
-- those transitions and inferring one from `reason text` would manufacture
-- data to make a column look populated. A null here means "not recorded",
-- which is a fact; a guessed enum value would not be.
--
-- ## `do_not_contact` must not require a reason
--
-- Checked rather than assumed: `closer_suppress` (current definition in
-- `20260827000100`) moves every reachable lead by calling `closer_set_stage`
-- with three arguments and no loss reason. Requiring one on `do_not_contact`
-- would make an opt-out raise, which is the one failure in this subsystem that
-- is not allowed to happen.

/* ------------------------------------------------------------------ *
 * The taxonomy
 * ------------------------------------------------------------------ */

/*
 * Nine values, in the order the brief lists them.
 *
 * A new enum type, so its values are usable in this same transaction —
 * `ALTER TYPE … ADD VALUE` is the statement that cannot be, which is what
 * forced `20261004000100` to be a migration of its own.
 *
 * `other` is the escape hatch and it is not free: `closer_set_stage` still
 * demands its free-text reason, and `summariseLosses` reports the share of
 * `other` so a taxonomy that stops fitting shows up as a number rather than
 * as nine buckets quietly absorbing everything.
 */
create type public.closer_loss_reason as enum (
  -- Out of scope: the prospect is not who this product is for.
  'has_tms',
  'no_multilingual_need',
  'wrong_framework',
  -- The conversation, not the product.
  'no_reply',
  'timing',
  'price',
  -- Post-install, and the two the design-partner track exists to find.
  'installed_never_used',
  'check_was_noisy',
  'other'
);

/* ------------------------------------------------------------------ *
 * Which reason can be given from which stage
 * ------------------------------------------------------------------ */

/*
 * A table rather than a CASE in the function, for the reason
 * `closer_stage_transitions` and `closer_track_stages` are tables: an
 * interface that has to offer the operator a list of reasons has to be able to
 * ask for one, and a list compiled into a function body cannot be asked.
 */
create table public.closer_loss_reason_stages (
  loss_reason public.closer_loss_reason not null,
  exit_stage public.closer_stage not null,
  primary key (loss_reason, exit_stage)
);

alter table public.closer_loss_reason_stages enable row level security;

-- The shape of the taxonomy, not data about anybody — readable like
-- `closer_stage_transitions` and `closer_track_stages`, and for the same
-- reason: the UI needs it to know which reasons to offer.
create policy closer_loss_reason_stages_select on public.closer_loss_reason_stages
  for select to authenticated using (true);

revoke all on table public.closer_loss_reason_stages from public, anon;
grant select on table public.closer_loss_reason_stages to authenticated;

/*
 * Generated, with exactly two restrictions.
 *
 * The temptation is to constrain much more than this — `has_tms` feels wrong
 * after an installation, `price` feels wrong before contact. Both are
 * judgements and both are sometimes true: a team can install, then discover
 * their existing Crowdin contract covers it. A constraint that an operator has
 * to lie to satisfy produces worse data than no constraint, so only the two
 * combinations that are *impossible* are excluded:
 *
 *   `installed_never_used` from a stage before the install. The lead never
 *   installed, so it cannot have installed and not used it.
 *
 *   `check_was_noisy` from a stage where no check has run. `installed` is the
 *   stage that means the App is connected and nothing has run yet, so the
 *   prospect has not seen a check to find noisy.
 *
 * Both are read against the stage the lead *left*, which `closer_set_stage`
 * takes from the row rather than from its caller — so neither can be defeated
 * by claiming a different exit stage.
 */
insert into public.closer_loss_reason_stages (loss_reason, exit_stage)
select r, s
from unnest(enum_range(null::public.closer_loss_reason)) r
cross join unnest(enum_range(null::public.closer_stage)) s
where
  /*
   * Terminal stages are not exit stages. A lead at `lost` has already left;
   * its reason is on the row that took it there, and `lost → do_not_contact`
   * is a suppression of an already-closed lead, not a second loss.
   */
  s <> all (array[
    'not_a_fit', 'not_now', 'unresponsive', 'lost', 'do_not_contact'
  ]::public.closer_stage[])
  and (
    r <> 'installed_never_used'
    or s = any (array[
      'installed', 'first_check', 'repeated_usage', 'pricing', 'paid'
    ]::public.closer_stage[])
  )
  and (
    r <> 'check_was_noisy'
    or s = any (array[
      'first_check', 'repeated_usage', 'pricing', 'paid'
    ]::public.closer_stage[])
  );

/* ------------------------------------------------------------------ *
 * The column
 * ------------------------------------------------------------------ */

alter table public.closer_stage_history
  add column loss_reason public.closer_loss_reason;

/*
 * Structural, and immune to every writer.
 *
 * MATCH SIMPLE — the default — skips the check entirely when any column of
 * the key is NULL, so the hundreds of existing rows and every future
 * non-loss transition pass without the pair table being consulted. A row that
 * *does* carry a reason must name a pair that exists.
 */
alter table public.closer_stage_history
  add constraint closer_stage_history_loss_reason_fits_exit_stage
  foreign key (loss_reason, from_stage)
  references public.closer_loss_reason_stages (loss_reason, exit_stage);

/*
 * A reason only ever describes a transition out of the funnel.
 *
 * `won` and `paid` are endpoints but not terminals, so this refuses a loss
 * reason on them too — which is right: a reason for losing a lead that was
 * won is not a data point, it is a contradiction.
 */
alter table public.closer_stage_history
  add constraint closer_stage_history_loss_reason_needs_terminal
  check (
    loss_reason is null
    or to_stage = any (array[
      'not_a_fit', 'not_now', 'unresponsive', 'lost', 'do_not_contact'
    ]::public.closer_stage[])
  );

-- Counting losses by reason and by exit stage is the whole point; both
-- are narrow and the table is append-only.
create index closer_stage_history_loss_idx
  on public.closer_stage_history (organization_id, loss_reason, from_stage)
  where loss_reason is not null;

/* ------------------------------------------------------------------ *
 * The reading surface
 * ------------------------------------------------------------------ */

/*
 * `exit_stage` beside `loss_reason`, from the row that holds both.
 *
 * `security_invoker` so the view is subject to the caller's RLS rather than
 * the owner's. Without it this would be a definer-shaped read of every
 * workspace's losses wearing the shape of a view — the same class of hole
 * `closer_is_suppressed` had before `20260916000100`, arriving by a different
 * door. The underlying select policy is what decides, and it is per-workspace.
 */
create view public.closer_losses
with (security_invoker = true)
as
select
  h.id,
  h.organization_id,
  h.lead_id,
  l.track,
  h.from_stage as exit_stage,
  h.to_stage as terminal_stage,
  h.loss_reason,
  h.reason as note,
  h.actor,
  h.created_at
from public.closer_stage_history h
join public.closer_leads l on l.id = h.lead_id
where h.loss_reason is not null;

revoke all on public.closer_losses from public, anon;
grant select on public.closer_losses to authenticated;

/* ------------------------------------------------------------------ *
 * The writer — the same one, with a fourth argument
 * ------------------------------------------------------------------ */

/*
 * Dropped and recreated rather than `create or replace`d.
 *
 * `create or replace` with a new signature does not replace anything: it adds
 * an **overload**, and a 3-argument call then matches both the old function
 * and the new one's default. That is not a hypothetical — it is the defect
 * `20261004000200` shipped and `closer-track.sql` now pins with
 * `set-stage-overloads=1`. `20260825000300` set the precedent by dropping the
 * forgeable 4-argument form outright.
 *
 * The new argument has a default, so the three existing callers are untouched:
 * `closer_suppress` in SQL, and the two `rpc('closer_set_stage', …)` calls in
 * `apps/web` that name their arguments.
 */
drop function if exists public.closer_set_stage(uuid, public.closer_stage, text);

create function public.closer_set_stage(
  p_lead_id uuid,
  p_to_stage public.closer_stage,
  p_reason text,
  p_loss_reason public.closer_loss_reason default null
)
returns public.closer_leads
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  lead public.closer_leads;
  company public.closer_companies;
  contact public.closer_contacts;
  updated public.closer_leads;
begin
  select * into lead from public.closer_leads where id = p_lead_id;
  if lead.id is null then
    raise exception 'lead not found' using errcode = '42704';
  end if;
  if not public.is_org_member(lead.organization_id) then
    raise exception 'not a member of this workspace' using errcode = '42501';
  end if;

  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'a stage change needs a reason' using errcode = '22023';
  end if;

  if lead.stage = p_to_stage then
    raise exception 'lead is already at %', p_to_stage using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.closer_stage_transitions t
    where t.from_stage = lead.stage and t.to_stage = p_to_stage
  ) then
    raise exception 'no transition from % to %', lead.stage, p_to_stage
      using errcode = '22023';
  end if;

  /*
   * An edge can exist and still belong to the other motion:
   * `interested → qualified_opportunity` is in the sales forward chain and
   * `interested` is shared, so without this a design-partner lead walks
   * straight into the sales funnel. The graph says what is structurally
   * possible; the track says which motion this lead is on.
   */
  if not exists (
    select 1 from public.closer_track_stages ts
    where ts.track = lead.track and ts.stage = p_to_stage
  ) then
    raise exception '% is not a stage on the % track', p_to_stage, lead.track
      using errcode = '22023';
  end if;

  /* ---- the loss reason ---- */

  /*
   * Required on the three terminals that mean a prospect was lost, and
   * **not** on the other two.
   *
   * `not_now` is excluded because it is the one terminal that can re-enter the
   * funnel — `not_now → ready_for_outreach` exists — so it records a postponed
   * conversation rather than a loss, and `timing` would be the only value it
   * could ever take. `do_not_contact` is excluded because `closer_suppress`
   * moves leads into it with no reason to give, and an opt-out that raises is
   * worse than an unclassified exit.
   */
  if p_loss_reason is null
     and p_to_stage = any (array[
       'not_a_fit', 'unresponsive', 'lost'
     ]::public.closer_stage[])
  then
    raise exception 'moving a lead to % needs a loss reason', p_to_stage
      using errcode = '22023';
  end if;

  if p_loss_reason is not null
     and p_to_stage <> all (array[
       'not_a_fit', 'not_now', 'unresponsive', 'lost', 'do_not_contact'
     ]::public.closer_stage[])
  then
    raise exception '% is not a stage a lead is lost at', p_to_stage
      using errcode = '22023';
  end if;

  /*
   * The exit stage is read from the row, never taken from the caller. The
   * foreign key on `closer_stage_history` enforces the same pair; this raise
   * exists so an operator gets a sentence instead of a constraint name.
   */
  if p_loss_reason is not null
     and not exists (
       select 1 from public.closer_loss_reason_stages lr
       where lr.loss_reason = p_loss_reason and lr.exit_stage = lead.stage
     )
  then
    raise exception '% is not a reason a lead can be lost for at %',
      p_loss_reason, lead.stage
      using errcode = '22023';
  end if;

  select * into company from public.closer_companies where id = lead.company_id;
  if lead.contact_id is not null then
    select * into contact from public.closer_contacts where id = lead.contact_id;
  end if;

  /*
   * The suppression test covers every contact of the company, not only the
   * lead's chosen one. `closer_leads.contact_id` is written by nothing in
   * this repository, so the narrower form's address arm was unreachable.
   */
  if p_to_stage <> 'do_not_contact'
     and (
       public.closer_is_suppressed(lead.organization_id, company.domain, contact.email)
       or exists (
         select 1 from public.closer_contacts ct
         where ct.company_id = company.id
           and public.closer_is_suppressed(lead.organization_id, null, ct.email)
       )
     )
  then
    raise exception 'this company or contact is suppressed'
      using errcode = '42501';
  end if;

  update public.closer_leads
     set stage = p_to_stage,
         stage_changed_at = now()
   where id = lead.id
  returning * into updated;

  insert into public.closer_stage_history
    (organization_id, lead_id, from_stage, to_stage, actor, reason, loss_reason)
  values
    (lead.organization_id, lead.id, lead.stage, p_to_stage, auth.uid(),
     trim(p_reason), p_loss_reason);

  return updated;
end;
$$;

revoke execute on function
  public.closer_set_stage(uuid, public.closer_stage, text, public.closer_loss_reason)
  from public, anon;
grant execute on function
  public.closer_set_stage(uuid, public.closer_stage, text, public.closer_loss_reason)
  to authenticated;
