-- Closer — the design-partner track: which stages it owns, and its edges.
--
-- The companion to `20261004000100`, which could only add the enum values:
-- Postgres refuses to use a value in the transaction that created it.
--
-- ## Why a track table instead of re-keying the transition graph
--
-- The obvious design is `closer_stage_transitions (track, from, to)`. It is
-- also a rewrite: every existing edge would have to be duplicated into a
-- `sales` track, the primary key changes, and `closer_set_stage` changes with
-- it — to express something the existing rows already express correctly.
--
-- So the graph stays as it is and says what is *structurally* possible, and a
-- second table says which stages a track owns. A move is allowed when both
-- agree. That is additive: no existing row is touched, and a lead on the
-- sales track behaves exactly as it did yesterday.

/* ------------------------------------------------------------------ *
 * The tracks
 * ------------------------------------------------------------------ */

create type public.closer_track as enum ('sales', 'design_partner');

create table public.closer_track_stages (
  track public.closer_track not null,
  stage public.closer_stage not null,
  primary key (track, stage)
);

alter table public.closer_track_stages enable row level security;

-- The shape of the funnel, not data about anybody. Readable like
-- `closer_stage_transitions`, and for the same reason: the UI needs it to
-- know which moves to offer.
create policy closer_track_stages_select on public.closer_track_stages
  for select to authenticated using (true);

/*
 * Terminal stages belong to both tracks.
 *
 * Generated rather than listed, so a stage added later cannot end up
 * reachable on one track and unreachable on the other — the most likely way
 * a lead gets stuck somewhere forever, and the same reasoning the original
 * migration applied to its terminal edges.
 */
insert into public.closer_track_stages (track, stage)
select t, s
from unnest(enum_range(null::public.closer_track)) t
cross join unnest(array[
  'not_a_fit', 'not_now', 'unresponsive', 'lost', 'do_not_contact'
]::public.closer_stage[]) s;

-- The sales track: everything it already had.
insert into public.closer_track_stages (track, stage)
select 'sales', s
from unnest(array[
  'discovered', 'researching', 'qualified', 'ready_for_outreach',
  'outreach_approved', 'contacted', 'replied', 'interested',
  'qualified_opportunity', 'meeting_requested', 'meeting_booked',
  'trial', 'negotiation', 'won'
]::public.closer_stage[]) s;

/*
 * The design-partner track: thirteen stages, not the twelve in the brief.
 *
 * `outreach_approved` sits between `ready_for_outreach` and `contacted`
 * because it is the stage that records a human opening the gate. The brief's
 * list goes straight from review to contact; routing around the approval
 * stage would make the approval invisible in `closer_stage_history`, which
 * is the one place it is auditable.
 *
 * `ready_for_outreach` is the brief's `ready_for_review`. Same state, and the
 * display label differs in `packages/closer-core` rather than the identifier
 * differing here — a second name for one state is how two columns start
 * disagreeing.
 */
insert into public.closer_track_stages (track, stage)
select 'design_partner', s
from unnest(array[
  'discovered', 'qualified', 'researched', 'ready_for_outreach',
  'outreach_approved', 'contacted', 'replied', 'interested',
  'installed', 'first_check', 'repeated_usage', 'pricing', 'paid'
]::public.closer_stage[]) s;

comment on table public.closer_track_stages is
  'Which stages each motion owns. A move needs an edge in closer_stage_transitions AND membership here, so a lead cannot wander between tracks.';

/* ------------------------------------------------------------------ *
 * Which track a lead is on
 * ------------------------------------------------------------------ */

/*
 * Default `design_partner`, backfill `sales`.
 *
 * The default describes the motion this product is running now; the backfill
 * describes the motion every existing row was created under. Defaulting
 * existing rows to the new track would silently reclassify history, and a
 * funnel that rewrites its own past is the one thing worse than a funnel
 * that records nothing.
 */
alter table public.closer_leads
  add column track public.closer_track not null default 'design_partner';

update public.closer_leads set track = 'sales';

create index closer_leads_track_stage_idx
  on public.closer_leads (organization_id, track, stage);

/* ------------------------------------------------------------------ *
 * The edges the design-partner track needs
 * ------------------------------------------------------------------ */

/*
 * The forward chain, and the first edge is the one that reverses an order.
 *
 * Sales research first and qualifies after (`discovered → researching →
 * qualified`). Design-partner acquisition qualifies on cheap public signals
 * first and only then spends the research (`discovered → qualified →
 * researched`), because research costs API calls and attention and most
 * candidates fail on a dependency list.
 *
 * Both orders now exist in the graph. Nothing forces a sales lead down the
 * new path: `researched` is not a sales stage, so the track check refuses it.
 */
insert into public.closer_stage_transitions (from_stage, to_stage, note) values
  ('discovered', 'qualified', 'Public signals support a fit, before spending research'),
  ('qualified', 'researched', 'Evidence gathered: pain, contributors, TMS'),
  ('researched', 'ready_for_outreach', 'A brief exists and an angle holds'),
  ('interested', 'installed', 'They installed the GitHub App'),
  ('installed', 'first_check', 'A check ran on one of their pull requests'),
  ('first_check', 'repeated_usage', 'Checks on several pull requests, over several days'),
  ('repeated_usage', 'pricing', 'They asked what it costs'),
  ('pricing', 'paid', 'They are paying')
on conflict do nothing;

-- Rework, for research that turns out thin.
insert into public.closer_stage_transitions (from_stage, to_stage, note) values
  ('researched', 'qualified', 'Sent back: the brief did not hold up')
on conflict do nothing;

/*
 * Shortcuts, for the two things that really happen.
 *
 * Somebody installs instead of replying with enthusiasm, and somebody asks
 * the price the moment the first check lands. A funnel that forbids either
 * is a funnel whose operator lies about the stage.
 */
insert into public.closer_stage_transitions (from_stage, to_stage, note) values
  ('replied', 'installed', 'They installed rather than answering'),
  ('first_check', 'pricing', 'They asked the price after one check')
on conflict do nothing;

/*
 * Terminal edges for the six new stages.
 *
 * The original migration generated these with `enum_range`, which ran before
 * these values existed — so every one of them has to be written out here or
 * a lead reaching them can never leave. That is exactly the failure the
 * original comment warned about, arriving from the direction it could not
 * cover.
 */
insert into public.closer_stage_transitions (from_stage, to_stage, note)
select s, 'do_not_contact', 'Suppressed — absorbing, no way out'
from unnest(array[
  'researched', 'installed', 'first_check', 'repeated_usage', 'pricing', 'paid'
]::public.closer_stage[]) s
on conflict do nothing;

-- Research can show there is nothing here, like every stage before contact.
insert into public.closer_stage_transitions (from_stage, to_stage, note) values
  ('researched', 'not_a_fit', 'The brief showed this is not the ICP')
on conflict do nothing;

/*
 * `lost` from every activation stage, and `installed → lost` is the one that
 * matters most.
 *
 * A design partner who installed and never ran a check is the most
 * informative failure this funnel can record: it says the problem is not
 * reach, not the pitch and not the price. Without this edge that lead sits
 * at `installed` forever and the funnel reports it as progress.
 */
insert into public.closer_stage_transitions (from_stage, to_stage, note)
select s, 'lost', 'An opportunity that did not close'
from unnest(array[
  'installed', 'first_check', 'repeated_usage', 'pricing'
]::public.closer_stage[]) s
on conflict do nothing;

insert into public.closer_stage_transitions (from_stage, to_stage, note)
select s, 'not_now', 'They asked to be approached later'
from unnest(array[
  'installed', 'first_check', 'repeated_usage', 'pricing'
]::public.closer_stage[]) s
on conflict do nothing;

/* ------------------------------------------------------------------ *
 * The track check, added to the one writer
 * ------------------------------------------------------------------ */

/*
 * The current signature is **three** arguments, not four, and the first draft
 * of this migration got that wrong in a way worth recording.
 *
 * `20260824000200` created `closer_set_stage(uuid, closer_stage, text, uuid)`
 * — the last argument being a caller-supplied actor. `20260825000300` found
 * that a signed-in member could attribute a stage change to an account that
 * was not even a member of the workspace, **dropped** that function and
 * replaced it with a three-argument one that reads `auth.uid()` itself.
 *
 * This file was written by copying the body out of the first migration,
 * which is the one a search for "create function closer_set_stage" shows you
 * first and the one that has been superseded. The result would have been
 * worse than doing nothing: `create or replace` on the four-argument
 * signature does not replace the three-argument function, it **adds a second
 * overload** — so the deliberately-deleted forgeable-actor version would have
 * come back, and both callers in `apps/web` pass three arguments and would
 * have kept resolving to the function without the track check. A guard that
 * the only two callers route around is not a guard.
 *
 * Caught by the Supabase advisor listing two `closer_set_stage` signatures
 * where there had been one, then confirmed in `pg_proc`. The rule is the one
 * this repository keeps relearning: the newest definition is not the one the
 * first file shows.
 *
 * The body below is `20260825000300`'s, unchanged except for one added
 * block — including the broadened suppression test, which the wrong copy had
 * also silently reverted to the narrower form.
 */

-- Undo the overload the first draft of this migration created. Harmless when
-- it was never applied; essential on the dev database, where it was.
drop function if exists public.closer_set_stage(uuid, public.closer_stage, text, uuid);

create or replace function public.closer_set_stage(
  p_lead_id uuid,
  p_to_stage public.closer_stage,
  p_reason text
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
   * The one new block.
   *
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
    (organization_id, lead_id, from_stage, to_stage, actor, reason)
  values
    (lead.organization_id, lead.id, lead.stage, p_to_stage, auth.uid(), trim(p_reason));

  return updated;
end;
$$;

revoke execute on function public.closer_set_stage(uuid, public.closer_stage, text)
  from public, anon;
grant execute on function public.closer_set_stage(uuid, public.closer_stage, text)
  to authenticated;
