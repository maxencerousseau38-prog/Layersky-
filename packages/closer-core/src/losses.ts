import { ACTIVATION_MILESTONES } from './activation.js';
import { CLOSER_STAGES, type CloserStage, type StageLabel } from './stages.js';

/**
 * Why leads were lost, counted.
 *
 * ## What is here and what is not
 *
 * **The reason-to-stage table is not mirrored here.** Which reasons may be
 * given from which exit stage lives in `public.closer_loss_reason_stages`, and
 * a surface that needs to offer an operator a list asks the database for it —
 * the same rule, for the same reason, as the transition graph in
 * `stages.ts`: a second copy drifts, and the drift is silent. The client would
 * offer a reason the database then refuses, or quietly omit a legitimate one
 * and nobody would notice, because the form would simply appear to have fewer
 * options.
 *
 * What lives here is what the database cannot answer: how to say these values
 * in English, and what a pile of them means.
 *
 * ## The one question this exists to answer
 *
 * A design-partner funnel can fail in two unrelated places, and the remedies
 * have nothing to do with each other:
 *
 *   **Acquisition** — the prospect never installed. Wrong people, wrong
 *   message, wrong moment. Fixed by changing who is approached and how.
 *
 *   **Activation** — the prospect installed and it did not stick. Fixed by
 *   changing the product, and no amount of outreach touches it.
 *
 * `exit_stage` separates them exactly, which is why it is reported beside the
 * reason rather than folded into it. Six leads lost for `timing` before
 * contact and six lost for `check_was_noisy` after installing are the same
 * number and opposite problems.
 */

/**
 * The nine values, mirroring `public.closer_loss_reason`.
 *
 * As with `CLOSER_STAGES`, the mirroring cannot be checked at unit-test time:
 * the database is the authority and rejects a value it does not know, which is
 * the real guard. The SQL proof asserts the two lists agree.
 */
export const CLOSER_LOSS_REASONS = [
  'has_tms',
  'no_multilingual_need',
  'wrong_framework',
  'no_reply',
  'timing',
  'price',
  'installed_never_used',
  'check_was_noisy',
  'other',
] as const;

export type CloserLossReason = (typeof CLOSER_LOSS_REASONS)[number];

/**
 * Wording, in one place — the same argument as `STAGE_LABELS`. Reading
 * `installed_never_used` raw in an interface tells an operator they are
 * looking at a table rather than at their pipeline.
 */
export const LOSS_REASON_LABELS: Record<CloserLossReason, StageLabel> = {
  has_tms: {
    label: 'Has a TMS',
    meaning:
      'They already run Crowdin, Lokalise, Phrase or similar. Out of scope rather than a worse fit',
  },
  no_multilingual_need: {
    label: 'No multilingual need',
    meaning: 'One language, and no plan to add another',
  },
  wrong_framework: {
    label: 'Wrong framework',
    meaning: 'Not i18next, which is the only library the check supports',
  },
  no_reply: {
    label: 'No reply',
    meaning: 'Contacted, never answered, follow-up budget spent',
  },
  timing: {
    label: 'Timing',
    meaning: 'Interested, but not during this quarter',
  },
  price: {
    label: 'Price',
    meaning: 'The number was the obstacle',
  },
  installed_never_used: {
    label: 'Installed, never used',
    meaning:
      'They connected the App and no check ever ran on a pull request. The most informative failure this funnel records',
  },
  check_was_noisy: {
    label: 'Check was noisy',
    meaning:
      'Checks ran and reported things they did not want to act on. A product defect, not a sales one',
  },
  other: {
    label: 'Other',
    meaning:
      'None of the above; the free-text note carries it. A rising share means this list is missing a value',
  },
};

/**
 * The terminals that mean a prospect was lost, and so require a reason.
 *
 * Two of the five terminal stages are deliberately absent, and the database
 * agrees — `closer_set_stage` raises on exactly this set:
 *
 *   `not_now` is the only terminal that can re-enter the funnel
 *   (`not_now → ready_for_outreach` is a real edge), so it records a
 *   postponement rather than a loss. `timing` would be the only value it could
 *   ever take, and a mandatory field with one possible answer collects nothing.
 *
 *   `do_not_contact` is reached by `closer_suppress`, which moves every lead an
 *   identifier touches and has no reason to supply. An opt-out that raises
 *   because a field is missing is the one failure here that is not allowed.
 *
 * Mirrored for the same narrow purpose `TERMINAL_STAGES` is: a form needs to
 * know whether to mark the field required before it submits. The raise is the
 * guard; this is the label on the door.
 */
export const LOSS_REASON_REQUIRED_STAGES = [
  'not_a_fit',
  'unresponsive',
  'lost',
] as const satisfies readonly CloserStage[];

const REQUIRES_REASON = new Set<string>(LOSS_REASON_REQUIRED_STAGES);

/** Whether moving a lead to this stage needs a loss reason. */
export function lossReasonRequired(stage: CloserStage): boolean {
  return REQUIRES_REASON.has(stage);
}

/**
 * Where in the funnel a loss happened — the split the whole module is for.
 *
 * Decided by the exit stage's membership of the activation chain, so it is
 * right on both tracks without a second list: every sales stage sits before
 * `installed` and reads as `acquisition`, which is true of it.
 */
export type LossPhase = 'acquisition' | 'activation';

const ACTIVATION = new Set<string>(ACTIVATION_MILESTONES);

export function lossPhase(exitStage: CloserStage): LossPhase {
  return ACTIVATION.has(exitStage) ? 'activation' : 'acquisition';
}

/** One row of `public.closer_losses`, reduced to what counting needs. */
export interface LossRow {
  exitStage: CloserStage;
  lossReason: CloserLossReason;
}

export interface LossCount<T> {
  key: T;
  count: number;
  /** Of the total losses, 0 to 1. */
  share: number;
}

export interface LossSummary {
  total: number;
  /** Descending by count; ties fall back to the order of the taxonomy. */
  byReason: LossCount<CloserLossReason>[];
  /** Descending by count; ties fall back to funnel order. */
  byExitStage: LossCount<CloserStage>[];
  byPhase: Record<LossPhase, number>;
  /** How many were recorded as `other`. */
  unclassified: number;
  /**
   * `other` as a fraction of the total, reported as a number and not as a
   * verdict.
   *
   * A boolean would need a threshold, and there is no evidence behind any
   * number that could be chosen — the same reason `/pricing` publishes no
   * figure that has not been modelled. What the number means is not in doubt:
   * `other` growing is this list failing to describe reality, and the remedy
   * is to amend the enum rather than to keep absorbing losses into a bucket
   * that explains nothing.
   */
  unclassifiedShare: number;
}

function tally<T extends string>(
  values: T[],
  total: number,
  order: readonly T[],
): LossCount<T>[] {
  const counts = new Map<T, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  return (
    [...counts.entries()]
      .map(([key, count]) => ({ key, count, share: count / total }))
      /*
       * Stable, so the same data renders the same way twice. A tie broken by
       * insertion order would reshuffle a table whenever a row arrived, and the
       * taxonomy's own order is the only tiebreak that does not depend on how
       * the rows happened to be read.
       */
      .sort((a, b) =>
        b.count !== a.count
          ? b.count - a.count
          : order.indexOf(a.key) - order.indexOf(b.key),
      )
  );
}

/**
 * Count a set of losses.
 *
 * Empty in, empty out — and `0` rather than a share of nothing. Zero losses is
 * a fact here, not a measurement nobody took: `closer_losses` has a row for
 * every loss with a reason, so no rows means no such loss. That is the same
 * distinction `deriveActivation` draws between `not_reached` and
 * `not_derivable`, landing on the other side of it.
 */
export function summariseLosses(
  rows: readonly LossRow[],
  /*
   * The order ties in `byExitStage` fall back to. Defaults to the enum's own
   * order, which is total; a track-aware surface passes `trackStages(track)`
   * to get funnel order, and a stage that track does not own sorts first,
   * which is visible rather than wrong.
   */
  stageOrder: readonly CloserStage[] = CLOSER_STAGES,
): LossSummary {
  const total = rows.length;
  if (total === 0) {
    return {
      total: 0,
      byReason: [],
      byExitStage: [],
      byPhase: { acquisition: 0, activation: 0 },
      unclassified: 0,
      unclassifiedShare: 0,
    };
  }

  const byPhase: Record<LossPhase, number> = {
    acquisition: 0,
    activation: 0,
  };
  for (const row of rows) {
    byPhase[lossPhase(row.exitStage)] += 1;
  }

  const unclassified = rows.filter((r) => r.lossReason === 'other').length;

  return {
    total,
    byReason: tally(
      rows.map((r) => r.lossReason),
      total,
      CLOSER_LOSS_REASONS,
    ),
    byExitStage: tally(
      rows.map((r) => r.exitStage),
      total,
      stageOrder,
    ),
    byPhase,
    unclassified,
    unclassifiedShare: unclassified / total,
  };
}
