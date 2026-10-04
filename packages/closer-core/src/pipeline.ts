import {
  CLOSER_STAGES,
  type CloserStage,
  type CloserTrack,
  isTerminal,
  trackStages,
} from './stages.js';

/**
 * Turning a bag of per-stage counts into something a person can read.
 *
 * Pure, and separate from the query, because the ordering decisions here are
 * the ones that quietly mislead. A pipeline drawn in alphabetical order tells
 * the reader nothing about flow; one that hides empty stages makes a funnel
 * look healthier than it is by omitting exactly the steps nothing reached.
 */

export interface StageCount {
  stage: CloserStage;
  count: number;
}

export interface PipelineSummary {
  /** The forward chain, in funnel order, including stages nothing reached. */
  active: StageCount[];
  /** Stages a lead stopped at, ordered by how many stopped there. */
  stopped: StageCount[];
  /** Leads anywhere on the forward chain. */
  activeTotal: number;
  /** Leads in a terminal state. */
  stoppedTotal: number;
  /** Customers. Counted apart from both — see below. */
  won: number;
}

/**
 * Empty stages are kept, and that is the point.
 *
 * A funnel that renders only the stages with leads in them is a funnel that
 * looks continuous when it has a hole: nine `contacted`, nothing `replied`,
 * three `interested` reads as a working pipeline instead of as the question it
 * should raise. Zero is a measurement.
 */
/**
 * One track's funnel, in that track's own order.
 *
 * Replaces the walk over `CLOSER_STAGES` this function used to do directly.
 * That walk was correct while every stage belonged to one funnel; with two
 * motions sharing an enum it would show a sales operator six empty
 * design-partner columns, and a design-partner operator the whole sales tail.
 *
 * It also no longer sorts. `trackStages` returns the funnel in order, where
 * the previous version recovered order from `indexOf` into the enum — which
 * is exactly the coupling that made appending the six new values the only
 * safe way to add them.
 */
export function summariseTrack(
  track: CloserTrack,
  counts: readonly StageCount[],
): PipelineSummary {
  const byStage = new Map<CloserStage, number>();
  for (const row of counts) {
    byStage.set(row.stage, (byStage.get(row.stage) ?? 0) + row.count);
  }

  const stages = trackStages(track);
  /*
   * The last stage of a track is its `won`, and it is reported separately
   * rather than as the final active column — `paid` for a design partner,
   * `won` for sales. Hard-coding `won` here would leave `paid` sitting in
   * `active` and `won` always reading zero on the new track.
   */
  const closed = stages[stages.length - 1] as CloserStage;

  const active = stages
    .filter((stage) => !isTerminal(stage) && stage !== closed)
    .map((stage) => ({ stage, count: byStage.get(stage) ?? 0 }));

  /*
   * Terminal stages sort by count, not by the enum.
   *
   * They are not a sequence — nothing flows from `not_a_fit` to `lost` — so
   * ordering them by position would invent a progression. What a reader wants
   * from this list is which wall leads hit most often, and the tie-break is
   * alphabetical so the order is stable between two loads.
   */
  const stopped = CLOSER_STAGES.filter(isTerminal)
    .map((stage) => ({ stage, count: byStage.get(stage) ?? 0 }))
    .sort((a, b) => b.count - a.count || a.stage.localeCompare(b.stage));

  return {
    active,
    stopped,
    activeTotal: active.reduce((sum, row) => sum + row.count, 0),
    stoppedTotal: stopped.reduce((sum, row) => sum + row.count, 0),
    /*
     * `won` is neither, and giving it its own field is the whole reason this
     * function exists rather than two `filter` calls at the call site. Counting
     * customers among "active" would say the work is unfinished; counting them
     * among "stopped" would file success with failure.
     */
    won: byStage.get(closed) ?? 0,
  };
}

/**
 * The sales funnel, unchanged.
 *
 * Kept as its own export because `apps/web` calls it and `pipeline.test.ts`
 * asserts its output. It is now one line over `summariseTrack` and produces
 * exactly what it produced before tracks existed: the sales stages in sales
 * order, the shared terminals, and `won`.
 */
export function summarisePipeline(
  counts: readonly StageCount[],
): PipelineSummary {
  return summariseTrack('sales', counts);
}
