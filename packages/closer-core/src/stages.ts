/**
 * The sales lifecycle, as the application needs to reason about it.
 *
 * **The allowed transitions are not here.** They live in
 * `public.closer_stage_transitions`, seeded by migration
 * `20260824000200_closer_transitions.sql`, and `closer_set_stage` is the only
 * writer of `stage`. Mirroring the edge list in TypeScript would create a
 * second authority that drifts from the first, and the drift would be silent:
 * the client would offer a move the database then refuses, or — worse — omit a
 * move that is legitimate, and nobody would notice because the funnel would
 * simply appear to have fewer doors.
 *
 * So the surfaces that need "what can this lead do next" ask the database. What
 * lives here is what the database cannot answer: the order stages appear in,
 * which of them mean the lead has stopped, and how to say them in English.
 * Those are presentation facts, and they belong on this side.
 *
 * The enum members mirror `public.closer_stage`. That mirroring cannot be
 * checked at unit-test time — the database is the authority and it rejects a
 * value it does not know, which is the real guard.
 */

export const CLOSER_STAGES = [
  'discovered',
  'researching',
  'qualified',
  'ready_for_outreach',
  'outreach_approved',
  'contacted',
  'replied',
  'interested',
  'qualified_opportunity',
  'meeting_requested',
  'meeting_booked',
  'trial',
  'negotiation',
  'won',
  'not_a_fit',
  'not_now',
  'unresponsive',
  'lost',
  'do_not_contact',
  /*
   * The design-partner stages, appended rather than slotted in beside their
   * neighbours.
   *
   * This array mirrors the `closer_stage` enum and `funnelPosition` is an
   * `indexOf` into it, so inserting `researched` after `qualified` would
   * shift every later stage and silently change `funnelProgress` for every
   * sales lead. Funnel *order* lives in the track lists at the bottom of this
   * file, where it is read deliberately; this list only says which values
   * exist.
   */
  'researched',
  'installed',
  'first_check',
  'repeated_usage',
  'pricing',
  'paid',
] as const;

export type CloserStage = (typeof CLOSER_STAGES)[number];

/**
 * Stages where the lead has stopped moving forward.
 *
 * `won` is deliberately **not** here. A won customer is not a lead that
 * stopped; it is the outcome the funnel exists to produce, and grouping it with
 * `lost` would make every funnel chart count success as an ending rather than
 * as the point.
 */
export const TERMINAL_STAGES = [
  'not_a_fit',
  'not_now',
  'unresponsive',
  'lost',
  'do_not_contact',
] as const;

export type TerminalStage = (typeof TERMINAL_STAGES)[number];

const TERMINAL = new Set<string>(TERMINAL_STAGES);

export function isTerminal(stage: CloserStage): stage is TerminalStage {
  return TERMINAL.has(stage);
}

/**
 * How far along the funnel a stage sits, for ordering a table by progress.
 *
 * Terminal stages return `null` rather than a large or a negative number.
 * Giving them a position would place them somewhere on the funnel, and a lead
 * that said "not now" is not further along than one being researched — it is
 * off the line entirely. Callers sorting by progress have to decide where to
 * put them, which is the decision that would otherwise be made by accident.
 */
export function funnelPosition(stage: CloserStage): number | null {
  if (isTerminal(stage)) return null;
  /*
   * Off the sales track is also `null`, for the same reason terminals are.
   *
   * This read `CLOSER_STAGES.indexOf(stage)` while every stage belonged to
   * one funnel. With the design-partner stages appended, that returned a
   * position past `won` for all six and `funnelProgress` duly reported 1.46
   * — a lead 146% of the way to a sale it is not being taken towards. A
   * stage on the other motion has no position on this one, which is exactly
   * what the terminal case already says.
   *
   * `trackPosition` and `trackProgress` are the track-aware pair; these two
   * stay because `apps/web` and the existing tests use them, and they now
   * answer only about sales.
   */
  if (!(SALES_TRACK as readonly CloserStage[]).includes(stage)) return null;
  return CLOSER_STAGES.indexOf(stage);
}

/** The furthest stage `won` sits at, used to normalise progress to a fraction. */
const WON_POSITION = CLOSER_STAGES.indexOf('won');

/**
 * Progress through the funnel as a fraction, or null for a stage that has left
 * it. `won` is 1; `discovered` is 0.
 */
export function funnelProgress(stage: CloserStage): number | null {
  const position = funnelPosition(stage);
  return position === null ? null : position / WON_POSITION;
}

export interface StageLabel {
  /** Sentence case, for a badge or a column. */
  label: string;
  /** What the stage means, for a tooltip or an empty state. */
  meaning: string;
}

/**
 * Wording, in one place.
 *
 * The stage names are database identifiers and reading them raw in an
 * interface — `qualified_opportunity` — is the kind of leak that tells a user
 * they are looking at a table rather than at their pipeline.
 */
export const STAGE_LABELS: Record<CloserStage, StageLabel> = {
  discovered: {
    label: 'Discovered',
    meaning: 'Found by discovery; nothing has been researched yet',
  },
  researching: {
    label: 'Researching',
    meaning: 'Evidence is being gathered',
  },
  qualified: {
    label: 'Qualified',
    meaning: 'The evidence supports a fit',
  },
  ready_for_outreach: {
    label: 'Ready for outreach',
    meaning: 'A contact and an angle exist; a draft is waiting',
  },
  outreach_approved: {
    label: 'Approved',
    meaning: 'A person approved the message; it has not left yet',
  },
  contacted: {
    label: 'Contacted',
    meaning: 'The message was sent',
  },
  replied: {
    label: 'Replied',
    meaning: 'They answered; the answer has not been judged yet',
  },
  interested: {
    label: 'Interested',
    meaning: 'The answer was positive',
  },
  qualified_opportunity: {
    label: 'Opportunity',
    meaning: 'Need, timing or budget is confirmed',
  },
  meeting_requested: {
    label: 'Meeting requested',
    meaning: 'A time has been proposed',
  },
  meeting_booked: {
    label: 'Meeting booked',
    meaning: 'A time is in the calendar',
  },
  trial: {
    label: 'Trial',
    meaning: 'They are using the product',
  },
  negotiation: {
    label: 'Negotiation',
    meaning: 'Terms are being discussed',
  },
  won: {
    label: 'Won',
    meaning: 'They are a paying customer',
  },
  not_a_fit: {
    label: 'Not a fit',
    meaning: 'The evidence did not support a fit',
  },
  not_now: {
    label: 'Not now',
    meaning:
      'They asked to be approached later; the only terminal state that can re-enter',
  },
  unresponsive: {
    label: 'Unresponsive',
    meaning: 'Contacted, never answered, follow-up budget spent',
  },
  lost: {
    label: 'Lost',
    meaning: 'A real opportunity that did not close',
  },
  do_not_contact: {
    label: 'Do not contact',
    meaning: 'Suppressed. Absorbing — there is no way out of this state',
  },
  /*
   * The design-partner stages read the same on either track except for the
   * one `DESIGN_PARTNER_LABELS` overrides, so their base labels live here
   * with the rest. `STAGE_LABELS` is a total record: a stage with no label
   * would be a stage the UI renders as its identifier.
   */
  researched: {
    label: 'Researched',
    meaning: 'A brief exists: evidence, an angle, and what was not verified',
  },
  installed: {
    label: 'Installed',
    meaning: 'They connected the GitHub App. Nothing has run yet',
  },
  first_check: {
    label: 'First check',
    meaning: 'A check ran on one of their pull requests',
  },
  repeated_usage: {
    label: 'Repeated usage',
    meaning: 'Checks on several pull requests, over several days',
  },
  pricing: {
    label: 'Pricing',
    meaning: 'They asked what it costs',
  },
  paid: {
    label: 'Paid',
    meaning: 'They are paying',
  },
};

/* ------------------------------------------------------------------ *
 * Tracks
 * ------------------------------------------------------------------ */

/**
 * The two motions, and why the stages are shared rather than duplicated.
 *
 * Design-partner acquisition and the original sales funnel agree on their
 * first eight beats — a prospect is discovered, qualified, researched,
 * reviewed, approved, contacted, replies, becomes interested — and diverge
 * completely afterwards. Sales ends in a meeting and a negotiation; a design
 * partner ends in an installation that gets used, or does not.
 *
 * Duplicating the shared eight under new names would make
 * `closer_stage_history` unreadable across the change and would double every
 * label. So a track is a **subset of the stages**, enforced by
 * `closer_track_stages` in the database: a move needs an edge in
 * `closer_stage_transitions` *and* membership in the lead's track.
 */
export const CLOSER_TRACKS = ['sales', 'design_partner'] as const;
export type CloserTrack = (typeof CLOSER_TRACKS)[number];

/**
 * The design-partner funnel, in order.
 *
 * **Thirteen, where the brief named twelve.** `outreach_approved` sits
 * between `ready_for_outreach` and `contacted` because it is the stage that
 * records a human opening the approval gate. The brief goes straight from
 * review to contact; routing around that stage would leave the approval
 * invisible in the stage history, which is the one place it is auditable.
 */
export const DESIGN_PARTNER_TRACK = [
  'discovered',
  'qualified',
  'researched',
  'ready_for_outreach',
  'outreach_approved',
  'contacted',
  'replied',
  'interested',
  'installed',
  'first_check',
  'repeated_usage',
  'pricing',
  'paid',
] as const satisfies readonly CloserStage[];

/** The original funnel, unchanged. */
export const SALES_TRACK = [
  'discovered',
  'researching',
  'qualified',
  'ready_for_outreach',
  'outreach_approved',
  'contacted',
  'replied',
  'interested',
  'qualified_opportunity',
  'meeting_requested',
  'meeting_booked',
  'trial',
  'negotiation',
  'won',
] as const satisfies readonly CloserStage[];

const TRACK_STAGES: Record<CloserTrack, readonly CloserStage[]> = {
  sales: SALES_TRACK,
  design_partner: DESIGN_PARTNER_TRACK,
};

/** The active stages of a track, in funnel order. Terminals are excluded. */
export function trackStages(track: CloserTrack): readonly CloserStage[] {
  return TRACK_STAGES[track];
}

/**
 * Terminal stages belong to every track.
 *
 * A lead can be suppressed, found not to fit or lost from either motion, so
 * membership is "on the track, or terminal" rather than a second list to
 * keep in step. The database generates its terminal rows the same way.
 */
export function onTrack(track: CloserTrack, stage: CloserStage): boolean {
  return isTerminal(stage) || TRACK_STAGES[track].includes(stage);
}

/** Position within a track, or null for a terminal or off-track stage. */
export function trackPosition(
  track: CloserTrack,
  stage: CloserStage,
): number | null {
  const index = TRACK_STAGES[track].indexOf(stage);
  return index === -1 ? null : index;
}

/**
 * How far along a track, 0 to 1.
 *
 * Measured against that track's own end — `paid` for a design partner,
 * `won` for sales — so the two are comparable as fractions even though they
 * have different lengths and different meanings.
 */
export function trackProgress(
  track: CloserTrack,
  stage: CloserStage,
): number | null {
  const position = trackPosition(track, stage);
  if (position === null) return null;
  return position / (TRACK_STAGES[track].length - 1);
}

/**
 * The one label that differs between the two motions.
 *
 * `ready_for_outreach` keeps its identifier everywhere — in the enum, in
 * every existing row, in `closer_stage_transitions` — and reads as "Ready for
 * review" on a design-partner lead. The state is the same one it always was:
 * a contact and an angle exist, and a person has not looked yet. A second
 * identifier for one state is how two columns start disagreeing; a second
 * *label* costs nothing.
 */
export const DESIGN_PARTNER_LABELS: Partial<Record<CloserStage, StageLabel>> = {
  ready_for_outreach: {
    label: 'Ready for review',
    meaning: 'A brief and a draft exist; a person has not approved them yet',
  },
};

export function stageLabel(track: CloserTrack, stage: CloserStage): StageLabel {
  if (track === 'design_partner') {
    const override = DESIGN_PARTNER_LABELS[stage];
    if (override) return override;
  }
  return STAGE_LABELS[stage];
}
