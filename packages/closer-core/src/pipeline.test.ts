import { describe, expect, it } from 'vitest';
import {
  type StageCount,
  summarisePipeline,
  summariseTrack,
} from './pipeline.js';
import {
  CLOSER_STAGES,
  DESIGN_PARTNER_TRACK,
  SALES_TRACK,
  TERMINAL_STAGES,
  isTerminal,
} from './stages.js';

const counts = (...rows: StageCount[]) => rows;

describe('summarisePipeline', () => {
  it('returns every forward stage for an empty pipeline', () => {
    const summary = summarisePipeline([]);
    expect(summary.active).toHaveLength(13);
    expect(summary.activeTotal).toBe(0);
    expect(summary.stoppedTotal).toBe(0);
    expect(summary.won).toBe(0);
  });

  /*
   * The reason this function exists rather than a filter at the call site.
   *
   * A pipeline rendered from only the stages that have leads looks continuous
   * when it has a hole: nine contacted, nothing replied, three interested reads
   * as a working funnel instead of as the question it should raise.
   */
  it('keeps stages nothing reached, so a hole in the funnel is visible', () => {
    const summary = summarisePipeline(
      counts(
        { stage: 'contacted', count: 9 },
        { stage: 'interested', count: 3 },
      ),
    );
    const replied = summary.active.find((r) => r.stage === 'replied');
    expect(replied).toBeDefined();
    expect(replied?.count).toBe(0);
  });

  it('orders the forward chain by funnel position', () => {
    const summary = summarisePipeline([]);
    const stages = summary.active.map((r) => r.stage);
    expect(stages[0]).toBe('discovered');
    expect(stages.indexOf('contacted')).toBeGreaterThan(
      stages.indexOf('qualified'),
    );
    expect(stages).not.toContain('won');
    for (const stage of stages) expect(isTerminal(stage)).toBe(false);
  });

  /*
   * Terminal stages are not a sequence — nothing flows from `not_a_fit` to
   * `lost` — so ordering them by enum position would invent a progression.
   * What a reader wants is which wall leads hit most often.
   */
  it('orders terminal stages by how many stopped there', () => {
    const summary = summarisePipeline(
      counts(
        { stage: 'lost', count: 2 },
        { stage: 'not_a_fit', count: 7 },
        { stage: 'unresponsive', count: 4 },
      ),
    );
    expect(summary.stopped.map((r) => r.stage).slice(0, 3)).toEqual([
      'not_a_fit',
      'unresponsive',
      'lost',
    ]);
  });

  it('breaks a tie between terminal stages the same way every time', () => {
    const first = summarisePipeline(
      counts({ stage: 'lost', count: 3 }, { stage: 'not_now', count: 3 }),
    );
    const again = summarisePipeline(
      counts({ stage: 'not_now', count: 3 }, { stage: 'lost', count: 3 }),
    );
    expect(first.stopped.map((r) => r.stage)).toEqual(
      again.stopped.map((r) => r.stage),
    );
  });

  /*
   * `won` is counted apart from both, and this is the assertion that pins it.
   *
   * Among "active" it would say the work is unfinished; among "stopped" it
   * would file success with failure. Either makes the one number the whole
   * pipeline exists to produce unreadable.
   */
  it('counts won separately from both active and stopped', () => {
    const summary = summarisePipeline(
      counts(
        { stage: 'won', count: 5 },
        { stage: 'contacted', count: 2 },
        { stage: 'lost', count: 1 },
      ),
    );
    expect(summary.won).toBe(5);
    expect(summary.activeTotal).toBe(2);
    expect(summary.stoppedTotal).toBe(1);
    expect(summary.active.some((r) => r.stage === 'won')).toBe(false);
    expect(summary.stopped.some((r) => r.stage === 'won')).toBe(false);
  });

  it('adds up duplicate rows for the same stage', () => {
    const summary = summarisePipeline(
      counts(
        { stage: 'contacted', count: 2 },
        { stage: 'contacted', count: 3 },
      ),
    );
    expect(summary.active.find((r) => r.stage === 'contacted')?.count).toBe(5);
    expect(summary.activeTotal).toBe(5);
  });

  /*
   * The invariant narrowed with the function, and deliberately.
   *
   * It used to be "every stage in the enum appears exactly once", which held
   * while one funnel owned every stage. `summarisePipeline` now describes the
   * sales track only, so the claim is that it covers *that* track plus the
   * shared terminals — and nothing else leaks in. Asserting the old count
   * would have been satisfied by putting six design-partner columns in a
   * sales operator's pipeline.
   */
  it('accounts for every sales stage exactly once, and no others', () => {
    const summary = summarisePipeline([]);
    const seen = [
      ...summary.active.map((r) => r.stage),
      ...summary.stopped.map((r) => r.stage),
      'won' as const,
    ];
    expect(new Set(seen).size).toBe(seen.length);
    expect(new Set(seen)).toEqual(
      new Set([...SALES_TRACK, ...TERMINAL_STAGES]),
    );
  });

  it('leaves the design-partner stages out of the sales pipeline', () => {
    const summary = summarisePipeline([
      { stage: 'installed', count: 3 },
      { stage: 'contacted', count: 1 },
    ]);
    expect(summary.active.map((r) => r.stage)).not.toContain('installed');
    // And the count is simply not represented, rather than silently folded
    // into a neighbouring stage.
    expect(summary.activeTotal).toBe(1);
  });
});

describe('summariseTrack', () => {
  it('walks the design-partner funnel in its own order', () => {
    const summary = summariseTrack('design_partner', []);
    expect(summary.active.map((r) => r.stage)).toEqual(
      DESIGN_PARTNER_TRACK.slice(0, -1),
    );
  });

  /*
   * `paid` is the design-partner `won`. Hard-coding `won` in the summary
   * would have left `paid` sitting in `active` — a customer reported as
   * work in progress — and `won` reading zero forever on this track.
   */
  it('reports the last stage of a track as won, not as an active column', () => {
    const summary = summariseTrack('design_partner', [
      { stage: 'paid', count: 2 },
      { stage: 'first_check', count: 1 },
    ]);
    expect(summary.won).toBe(2);
    expect(summary.activeTotal).toBe(1);
    expect(summary.active.map((r) => r.stage)).not.toContain('paid');
  });

  it('keeps empty stages, on either track', () => {
    const summary = summariseTrack('design_partner', [
      { stage: 'contacted', count: 2 },
    ]);
    const installed = summary.active.find((r) => r.stage === 'installed');
    expect(installed).toEqual({ stage: 'installed', count: 0 });
  });

  it('shares the terminal breakdown between tracks', () => {
    const counts = [{ stage: 'not_a_fit' as const, count: 4 }];
    expect(summariseTrack('design_partner', counts).stopped).toEqual(
      summariseTrack('sales', counts).stopped,
    );
  });

  it('is what summarisePipeline delegates to', () => {
    const counts = [
      { stage: 'contacted' as const, count: 2 },
      { stage: 'lost' as const, count: 1 },
    ];
    expect(summarisePipeline(counts)).toEqual(summariseTrack('sales', counts));
  });
});
