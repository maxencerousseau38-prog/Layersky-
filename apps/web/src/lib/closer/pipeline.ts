import 'server-only';
import { createClient } from '@/lib/supabase/server';
import {
  CLOSER_TRACKS,
  type CloserLossReason,
  type CloserStage,
  type CloserTrack,
} from '@localize-infra/closer-core';

/**
 * The pipeline, and one lead in full.
 *
 * ## Leads, not companies
 *
 * This reads `closer_leads` and embeds the company rather than the other way
 * round, because a track and a stage are properties of a lead. Filtering an
 * embedded resource in PostgREST would either drop the companies that have no
 * lead or filter a page of a hundred rows rather than the set — and the second
 * is the kind of wrong that only shows up once there are more than a hundred.
 *
 * A company without a lead cannot appear here, and that is not a gap:
 * `recordCompany` opens one in the same action that records the company, so a
 * company without a lead is a failed write rather than a state the funnel has
 * to represent.
 *
 * ## Nothing about the funnel's shape is written down here
 *
 * Which stages a track owns comes from `closer_track_stages` through
 * `trackStages`, which moves are legal comes from `closer_stage_transitions`,
 * and which loss reasons fit a stage comes from `closer_loss_reason_stages`.
 * All three are read, never mirrored — the rule `stages.ts` states and the
 * reason `losses.ts` deliberately does not carry the pair table: a second copy
 * drifts, and the drift is silent, because the client would simply appear to
 * offer fewer doors.
 */

export interface PipelineFilter {
  track: CloserTrack | null;
  stage: CloserStage | null;
}

export interface PipelineLead {
  id: string;
  stage: CloserStage;
  track: CloserTrack;
  stageChangedAt: string;
  nextAction: string | null;
  company: {
    id: string;
    name: string;
    domain: string | null;
    repository: string | null;
    discoveredUrl: string | null;
    locales: string[];
  };
  evidence: { label: string; summary: string; kind: string }[];
  scores: { kind: string; value: number; confidence: number }[];
}

interface LeadRow {
  id: string;
  stage: CloserStage;
  track: CloserTrack;
  stage_changed_at: string;
  next_action: string | null;
  closer_companies: {
    id: string;
    name: string;
    domain: string | null;
    repository: string | null;
    discovered_url: string | null;
    locales: string[] | null;
    closer_evidence: { label: string; summary: string; kind: string }[];
    closer_scores: { kind: string; value: number; confidence: number }[];
  };
}

const LEAD_SELECT =
  'id,stage,track,stage_changed_at,next_action,' +
  'closer_companies!inner(id,name,domain,repository,discovered_url,locales,' +
  'closer_evidence(label,summary,kind),closer_scores(kind,value,confidence))';

function toLead(row: LeadRow): PipelineLead {
  const c = row.closer_companies;
  return {
    id: row.id,
    stage: row.stage,
    track: row.track,
    stageChangedAt: row.stage_changed_at,
    nextAction: row.next_action,
    company: {
      id: c.id,
      name: c.name,
      domain: c.domain,
      repository: c.repository,
      discoveredUrl: c.discovered_url,
      locales: c.locales ?? [],
    },
    evidence: c.closer_evidence ?? [],
    scores: c.closer_scores ?? [],
  };
}

/** A track name from a query string, or null for "every track". */
export function parseTrack(value: string | undefined): CloserTrack | null {
  if (!value) return null;
  return (CLOSER_TRACKS as readonly string[]).includes(value)
    ? (value as CloserTrack)
    : null;
}

/**
 * A stage from a query string, or null.
 *
 * Not validated against the stage list here. An unknown value reaches
 * PostgREST, which rejects it against the enum and the page reports the error
 * — the database is the authority on what a stage is, and a client-side list
 * to check against would be the mirror this module exists to avoid.
 */
export function parseStage(value: string | undefined): CloserStage | null {
  return value ? (value as CloserStage) : null;
}

export interface Pipeline {
  leads: PipelineLead[];
  /** How many leads the filter matched, independent of the page size. */
  total: number;
  error: string | null;
}

export async function loadPipeline(
  filter: PipelineFilter,
  limit = 100,
): Promise<Pipeline> {
  const supabase = await createClient();

  let query = supabase
    .from('closer_leads')
    .select(LEAD_SELECT, { count: 'exact' })
    .order('stage_changed_at', { ascending: false })
    .limit(limit);

  if (filter.track) query = query.eq('track', filter.track);
  if (filter.stage) query = query.eq('stage', filter.stage);

  const { data, error, count } = await query;

  if (error) return { leads: [], total: 0, error: error.message };

  const rows = (data ?? []) as unknown as LeadRow[];
  return { leads: rows.map(toLead), total: count ?? rows.length, error: null };
}

/* ------------------------------------------------------------------ *
 * One lead, in full
 * ------------------------------------------------------------------ */

export interface StageTransition {
  toStage: CloserStage;
  note: string;
}

export interface StageHistoryEntry {
  id: string;
  fromStage: CloserStage | null;
  toStage: CloserStage;
  reason: string;
  lossReason: CloserLossReason | null;
  actor: string | null;
  createdAt: string;
}

export interface LeadDetail {
  lead: PipelineLead;
  contact: {
    fullName: string | null;
    roleTitle: string | null;
    email: string | null;
  } | null;
  history: StageHistoryEntry[];
  /** Moves the database will accept from here, read from the two tables. */
  moves: StageTransition[];
  /** Loss reasons valid at this lead's current stage, read from the table. */
  lossReasons: CloserLossReason[];
  /**
   * The loss, when this lead is lost. `exitStage` is `from_stage` on the
   * transition that ended it — not a second column that could disagree.
   */
  loss: {
    exitStage: CloserStage;
    lossReason: CloserLossReason;
    note: string;
    at: string;
  } | null;
}

/**
 * Three outcomes, not two.
 *
 * `missing` and `error` were one `null` here, and the page turned both into a
 * 404 — so a transient Postgres failure told the operator their lead had
 * ceased to exist. They are different facts with different remedies: one is
 * "this is not yours or not there", the other is "try again". The pipeline
 * page already reports the database's own message rather than shrugging, and
 * this is the same shape.
 *
 * `maybeSingle()` is what makes the split clean: zero rows come back as
 * `data: null, error: null`, so a non-null `error` is only ever a real
 * failure.
 */
export type LeadDetailResult =
  | { kind: 'ok'; detail: LeadDetail }
  | { kind: 'missing' }
  | { kind: 'error'; message: string };

export async function loadLeadDetail(
  leadId: string,
): Promise<LeadDetailResult> {
  const supabase = await createClient();

  const { data: leadData, error } = await supabase
    .from('closer_leads')
    .select(`${LEAD_SELECT},contact_id`)
    .eq('id', leadId)
    .maybeSingle();

  if (error) return { kind: 'error', message: error.message };
  if (!leadData) return { kind: 'missing' };
  const row = leadData as unknown as LeadRow & { contact_id: string | null };
  const lead = toLead(row);

  /*
   * Read together, because none of them depends on another. The two reference
   * tables are tiny and the history of one lead is a handful of rows.
   */
  const [contactRes, historyRes, movesRes, reasonsRes, lossRes] =
    await Promise.all([
      row.contact_id
        ? supabase
            .from('closer_contacts')
            .select('full_name,role_title,email')
            .eq('id', row.contact_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      supabase
        .from('closer_stage_history')
        .select('id,from_stage,to_stage,reason,loss_reason,actor,created_at')
        .eq('lead_id', leadId)
        .order('created_at', { ascending: false }),
      supabase
        .from('closer_stage_transitions')
        .select('to_stage,note')
        .eq('from_stage', lead.stage),
      supabase
        .from('closer_loss_reason_stages')
        .select('loss_reason')
        .eq('exit_stage', lead.stage),
      supabase
        .from('closer_losses')
        .select('exit_stage,loss_reason,note,created_at')
        .eq('lead_id', leadId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

  /*
   * A move needs an edge *and* membership of this lead's track. The edge list
   * is filtered by the track's stages rather than trusted, because
   * `closer_set_stage` applies both and offering a move it will refuse is the
   * drift this module is built to avoid.
   */
  const { data: trackStageRows } = await supabase
    .from('closer_track_stages')
    .select('stage')
    .eq('track', lead.track);
  const onTrack = new Set(
    ((trackStageRows ?? []) as { stage: CloserStage }[]).map((r) => r.stage),
  );

  const moves = (
    (movesRes.data ?? []) as { to_stage: CloserStage; note: string }[]
  )
    .filter((m) => onTrack.has(m.to_stage))
    .map((m) => ({ toStage: m.to_stage, note: m.note }));

  const history = (
    (historyRes.data ?? []) as {
      id: string;
      from_stage: CloserStage | null;
      to_stage: CloserStage;
      reason: string;
      loss_reason: CloserLossReason | null;
      actor: string | null;
      created_at: string;
    }[]
  ).map((h) => ({
    id: h.id,
    fromStage: h.from_stage,
    toStage: h.to_stage,
    reason: h.reason,
    lossReason: h.loss_reason,
    actor: h.actor,
    createdAt: h.created_at,
  }));

  const lossRow = lossRes.data as {
    exit_stage: CloserStage;
    loss_reason: CloserLossReason;
    note: string;
    created_at: string;
  } | null;

  const contactRow = contactRes.data as {
    full_name: string | null;
    role_title: string | null;
    email: string | null;
  } | null;

  const detail: LeadDetail = {
    lead,
    contact: contactRow
      ? {
          fullName: contactRow.full_name,
          roleTitle: contactRow.role_title,
          email: contactRow.email,
        }
      : null,
    history,
    moves,
    lossReasons: (
      (reasonsRes.data ?? []) as { loss_reason: CloserLossReason }[]
    ).map((r) => r.loss_reason),
    loss: lossRow
      ? {
          exitStage: lossRow.exit_stage,
          lossReason: lossRow.loss_reason,
          note: lossRow.note,
          at: lossRow.created_at,
        }
      : null,
  };

  return { kind: 'ok', detail };
}
