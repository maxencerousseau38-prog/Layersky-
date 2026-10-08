import { describe, expect, it } from 'vitest';
import {
  CLOSER_STAGES,
  CLOSER_TRACKS,
  type CloserStage,
  DESIGN_PARTNER_TRACK,
  SALES_TRACK,
  STAGE_LABELS,
  TERMINAL_STAGES,
  funnelPosition,
  funnelProgress,
  isTerminal,
  onTrack,
  stageLabel,
  trackPosition,
  trackProgress,
  trackStages,
} from './stages.js';

describe('the stage vocabulary', () => {
  it('names every stage exactly once', () => {
    expect(new Set(CLOSER_STAGES).size).toBe(CLOSER_STAGES.length);
  });

  /*
   * A stage without wording renders its database identifier —
   * "qualified_opportunity" — which tells the reader they are looking at a
   * table rather than at their pipeline. The Record type catches a missing key
   * at compile time; this catches a key that exists with nothing in it.
   */
  it('gives every stage a label and a meaning', () => {
    for (const stage of CLOSER_STAGES) {
      expect(STAGE_LABELS[stage].label.trim()).not.toBe('');
      expect(STAGE_LABELS[stage].meaning.trim()).not.toBe('');
    }
  });

  it('draws terminal stages from the stage list', () => {
    for (const stage of TERMINAL_STAGES) {
      expect(CLOSER_STAGES).toContain(stage);
    }
  });
});

describe('isTerminal', () => {
  it.each(TERMINAL_STAGES)('treats %s as terminal', (stage) => {
    expect(isTerminal(stage)).toBe(true);
  });

  /*
   * The one that matters.
   *
   * Grouping `won` with `lost` because both are endings would make every funnel
   * chart count success as a stop rather than as the point. It is the outcome
   * the pipeline exists to produce.
   */
  it('does not treat won as terminal', () => {
    expect(isTerminal('won')).toBe(false);
  });

  it('treats every stage on the forward chain as non-terminal', () => {
    const active = CLOSER_STAGES.filter(
      (s) => !(TERMINAL_STAGES as readonly string[]).includes(s),
    );
    /*
     * Counted from the two tracks rather than written as a literal. The
     * literal said 14 and went stale the moment the design-partner stages
     * landed; the union is what the claim actually means, and it stays true
     * the next time a track gains a stage.
     */
    const onATrack = new Set<CloserStage>([
      ...SALES_TRACK,
      ...DESIGN_PARTNER_TRACK,
    ]);
    expect(active).toHaveLength(onATrack.size);
    for (const stage of active) {
      expect(isTerminal(stage)).toBe(false);
      expect(onATrack.has(stage)).toBe(true);
    }
  });
});

describe('funnelPosition', () => {
  it('orders the forward chain', () => {
    expect(funnelPosition('discovered')).toBe(0);
    expect(funnelPosition('contacted')).toBeGreaterThan(
      funnelPosition('qualified') as number,
    );
    expect(funnelPosition('won')).toBeGreaterThan(
      funnelPosition('negotiation') as number,
    );
  });

  /*
   * Null rather than a number, and this is the design rather than a gap.
   *
   * Any number would place a terminal stage somewhere on the funnel, and a lead
   * that said "not now" is not further along than one being researched — it is
   * off the line. Returning null forces the caller to decide where such rows
   * sort, which is the decision that would otherwise be made by accident.
   */
  it.each(TERMINAL_STAGES)('returns null for %s', (stage) => {
    expect(funnelPosition(stage)).toBeNull();
  });
});

describe('funnelProgress', () => {
  it('runs from 0 at discovered to 1 at won', () => {
    expect(funnelProgress('discovered')).toBe(0);
    expect(funnelProgress('won')).toBe(1);
  });

  it('increases monotonically along the chain', () => {
    const chain: CloserStage[] = CLOSER_STAGES.filter(
      (s) => funnelProgress(s) !== null,
    );
    const values = chain.map((s) => funnelProgress(s) as number);
    for (let i = 1; i < values.length; i += 1) {
      expect(values[i] as number).toBeGreaterThan(values[i - 1] as number);
    }
  });

  it('stays within 0 and 1', () => {
    for (const stage of CLOSER_STAGES) {
      const value = funnelProgress(stage);
      if (value === null) continue;
      expect(value, stage).toBeGreaterThanOrEqual(0);
      expect(value, stage).toBeLessThanOrEqual(1);
    }
  });

  /*
   * The bug this caught. `funnelProgress` divides by the index of `won`, so
   * once the design-partner stages were appended to the enum they reported
   * 1.46 — a lead 146% of the way towards a sale nobody is taking it
   * towards. A stage belonging to the other motion has no position on this
   * funnel, exactly as a terminal stage does not.
   */
  it.each(
    DESIGN_PARTNER_TRACK.filter(
      (stage) => !(SALES_TRACK as readonly string[]).includes(stage),
    ),
  )('has no sales-funnel progress for %s', (stage) => {
    expect(funnelProgress(stage)).toBeNull();
    expect(funnelPosition(stage)).toBeNull();
  });

  it.each(TERMINAL_STAGES)('has no progress for %s', (stage) => {
    expect(funnelProgress(stage)).toBeNull();
  });
});

describe('tracks', () => {
  it('lists the design-partner funnel in order, ending at paid', () => {
    expect(trackStages('design_partner')).toEqual(DESIGN_PARTNER_TRACK);
    expect(DESIGN_PARTNER_TRACK[0]).toBe('discovered');
    expect(DESIGN_PARTNER_TRACK[DESIGN_PARTNER_TRACK.length - 1]).toBe('paid');
  });

  /*
   * The thirteenth stage, and the reason it is there. The brief listed twelve
   * and went straight from review to contact; `outreach_approved` is the
   * stage that records a human opening the gate, so routing around it would
   * make the approval invisible in `closer_stage_history`.
   */
  it('keeps the approval stage between review and contact', () => {
    const order = DESIGN_PARTNER_TRACK as readonly CloserStage[];
    expect(order).toHaveLength(13);
    expect(order.indexOf('outreach_approved')).toBe(
      order.indexOf('ready_for_outreach') + 1,
    );
    expect(order.indexOf('contacted')).toBe(
      order.indexOf('outreach_approved') + 1,
    );
  });

  /*
   * The order reversal that is the whole point of the new track: sales
   * researches then qualifies, design-partner acquisition qualifies on cheap
   * public signals and only then spends the research.
   */
  it('qualifies before researching, where sales does the opposite', () => {
    const dp = DESIGN_PARTNER_TRACK as readonly CloserStage[];
    expect(dp.indexOf('qualified')).toBeLessThan(dp.indexOf('researched'));

    const sales = SALES_TRACK as readonly CloserStage[];
    expect(sales.indexOf('researching')).toBeLessThan(
      sales.indexOf('qualified'),
    );
  });

  it('leaves the sales track exactly as it was', () => {
    expect(SALES_TRACK).toEqual(
      CLOSER_STAGES.filter(
        (stage) =>
          !isTerminal(stage) &&
          !(
            [
              'researched',
              'installed',
              'first_check',
              'repeated_usage',
              'pricing',
              'paid',
            ] as readonly string[]
          ).includes(stage),
      ),
    );
  });

  it('puts every terminal stage on every track', () => {
    for (const stage of TERMINAL_STAGES) {
      expect(onTrack('sales', stage)).toBe(true);
      expect(onTrack('design_partner', stage)).toBe(true);
    }
  });

  it('keeps each motion off the other one', () => {
    expect(onTrack('design_partner', 'negotiation')).toBe(false);
    expect(onTrack('design_partner', 'researching')).toBe(false);
    expect(onTrack('sales', 'installed')).toBe(false);
    expect(onTrack('sales', 'researched')).toBe(false);
  });

  it('shares the eight stages both motions agree on', () => {
    for (const stage of [
      'discovered',
      'qualified',
      'ready_for_outreach',
      'outreach_approved',
      'contacted',
      'replied',
      'interested',
    ] as const) {
      expect(onTrack('sales', stage)).toBe(true);
      expect(onTrack('design_partner', stage)).toBe(true);
    }
  });

  it('has no position for a stage on the other track', () => {
    expect(trackPosition('design_partner', 'negotiation')).toBeNull();
    expect(trackProgress('design_partner', 'negotiation')).toBeNull();
    expect(trackPosition('sales', 'installed')).toBeNull();
  });

  it('runs progress from 0 at discovery to 1 at the end of each track', () => {
    expect(trackProgress('design_partner', 'discovered')).toBe(0);
    expect(trackProgress('design_partner', 'paid')).toBe(1);
    expect(trackProgress('sales', 'discovered')).toBe(0);
    expect(trackProgress('sales', 'won')).toBe(1);
  });

  it('stays within 0 and 1 across both tracks', () => {
    for (const track of CLOSER_TRACKS) {
      for (const stage of trackStages(track)) {
        const value = trackProgress(track, stage);
        expect(value, `${track}/${stage}`).not.toBeNull();
        expect(value as number).toBeGreaterThanOrEqual(0);
        expect(value as number).toBeLessThanOrEqual(1);
      }
    }
  });

  /*
   * The relabelling, and the thing it must not do. `ready_for_outreach` is
   * the identifier in the enum, in every existing row and in every
   * transition; only what a design-partner operator reads changes.
   */
  it('reads ready_for_outreach as "Ready for review" on the new track only', () => {
    expect(stageLabel('design_partner', 'ready_for_outreach').label).toBe(
      'Ready for review',
    );
    expect(stageLabel('sales', 'ready_for_outreach').label).toBe(
      'Ready for outreach',
    );
    // The identifier itself is untouched: it is still a member of the enum
    // under its original name, on both tracks.
    expect(CLOSER_STAGES).toContain('ready_for_outreach');
    expect(onTrack('design_partner', 'ready_for_outreach')).toBe(true);
  });

  it('falls through to the shared label everywhere else', () => {
    for (const stage of CLOSER_STAGES) {
      if (stage === 'ready_for_outreach') continue;
      expect(stageLabel('design_partner', stage)).toEqual(STAGE_LABELS[stage]);
      expect(stageLabel('sales', stage)).toEqual(STAGE_LABELS[stage]);
    }
  });

  it('gives every stage a label, so none renders as its identifier', () => {
    for (const stage of CLOSER_STAGES) {
      expect(STAGE_LABELS[stage]?.label ?? '').not.toBe('');
      expect(STAGE_LABELS[stage]?.meaning ?? '').not.toBe('');
    }
  });
});
