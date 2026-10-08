import { describe, expect, it } from 'vitest';
import { ACTIVATION_MILESTONES } from './activation.js';
import {
  CLOSER_LOSS_REASONS,
  type CloserLossReason,
  LOSS_REASON_LABELS,
  LOSS_REASON_REQUIRED_STAGES,
  type LossRow,
  lossPhase,
  lossReasonRequired,
  summariseLosses,
} from './losses.js';
import {
  type CloserStage,
  DESIGN_PARTNER_TRACK,
  SALES_TRACK,
  TERMINAL_STAGES,
  trackStages,
} from './stages.js';

function loss(exitStage: CloserStage, lossReason: CloserLossReason): LossRow {
  return { exitStage, lossReason };
}

describe('the taxonomy', () => {
  it('has the nine values the brief named, in that order', () => {
    expect([...CLOSER_LOSS_REASONS]).toEqual([
      'has_tms',
      'no_multilingual_need',
      'wrong_framework',
      'no_reply',
      'timing',
      'price',
      'installed_never_used',
      'check_was_noisy',
      'other',
    ]);
  });

  /*
   * Total, like `STAGE_LABELS`. A reason with no label is a reason the
   * interface renders as its database identifier.
   */
  it('labels every value', () => {
    for (const reason of CLOSER_LOSS_REASONS) {
      expect(LOSS_REASON_LABELS[reason].label.length).toBeGreaterThan(0);
      expect(LOSS_REASON_LABELS[reason].meaning.length).toBeGreaterThan(0);
    }
    expect(Object.keys(LOSS_REASON_LABELS)).toHaveLength(
      CLOSER_LOSS_REASONS.length,
    );
  });
});

describe('lossReasonRequired', () => {
  it('requires one on the three terminals that mean a loss', () => {
    expect(lossReasonRequired('lost')).toBe(true);
    expect(lossReasonRequired('not_a_fit')).toBe(true);
    expect(lossReasonRequired('unresponsive')).toBe(true);
  });

  /*
   * The two exclusions, each for its own reason. `not_now` can re-enter the
   * funnel, so it is a postponement; `do_not_contact` is written by
   * `closer_suppress`, which has no reason to give, and an opt-out that raises
   * is worse than an unclassified exit.
   */
  it('does not require one on not_now or do_not_contact', () => {
    expect(lossReasonRequired('not_now')).toBe(false);
    expect(lossReasonRequired('do_not_contact')).toBe(false);
  });

  it('requires nothing of an active stage', () => {
    for (const stage of [...SALES_TRACK, ...DESIGN_PARTNER_TRACK]) {
      expect(lossReasonRequired(stage)).toBe(false);
    }
  });

  it('only ever requires one on a terminal', () => {
    for (const stage of LOSS_REASON_REQUIRED_STAGES) {
      expect(TERMINAL_STAGES).toContain(stage);
    }
  });
});

describe('lossPhase', () => {
  /*
   * The split that decides whether a loss is an outreach problem or a product
   * problem, and the reason `exit_stage` is reported beside the reason rather
   * than folded into it.
   */
  it('calls every activation stage an activation failure', () => {
    for (const stage of ACTIVATION_MILESTONES) {
      expect(lossPhase(stage)).toBe('activation');
    }
  });

  it('calls everything before the install an acquisition failure', () => {
    for (const stage of [
      'discovered',
      'qualified',
      'researched',
      'ready_for_outreach',
      'outreach_approved',
      'contacted',
      'replied',
      'interested',
    ] as const) {
      expect(lossPhase(stage)).toBe('acquisition');
    }
  });

  /*
   * A sales lead has no activation half at all, so every sales stage reads as
   * acquisition — which is true of it, and is why this needs no second list
   * per track.
   */
  it('reads every sales stage as acquisition', () => {
    for (const stage of SALES_TRACK) {
      expect(lossPhase(stage)).toBe('acquisition');
    }
  });
});

describe('summariseLosses', () => {
  it('counts nothing as nothing, not as a share of nothing', () => {
    const summary = summariseLosses([]);
    expect(summary).toEqual({
      total: 0,
      byReason: [],
      byExitStage: [],
      byPhase: { acquisition: 0, activation: 0 },
      unclassified: 0,
      unclassifiedShare: 0,
    });
    expect(summary.unclassifiedShare).not.toBeNaN();
  });

  const MIXED: LossRow[] = [
    loss('installed', 'installed_never_used'),
    loss('installed', 'installed_never_used'),
    loss('installed', 'installed_never_used'),
    loss('first_check', 'check_was_noisy'),
    loss('contacted', 'no_reply'),
    loss('interested', 'timing'),
    loss('qualified', 'has_tms'),
    loss('replied', 'other'),
  ];

  it('ranks reasons by count, largest first', () => {
    const { byReason } = summariseLosses(MIXED);
    expect(byReason[0]).toEqual({
      key: 'installed_never_used',
      count: 3,
      share: 3 / 8,
    });
    expect(byReason.map((r) => r.count)).toEqual([3, 1, 1, 1, 1, 1]);
  });

  /*
   * Deterministic ties. Five reasons appear once each; without a tiebreak
   * their order would depend on the order the rows happened to arrive in, and
   * a table would reshuffle itself every time a row was added.
   */
  it('breaks ties on the taxonomy order, not on arrival order', () => {
    const forward = summariseLosses(MIXED).byReason.map((r) => r.key);
    const reversed = summariseLosses([...MIXED].reverse()).byReason.map(
      (r) => r.key,
    );
    expect(forward).toEqual(reversed);
    expect(forward.slice(1)).toEqual([
      'has_tms',
      'no_reply',
      'timing',
      'check_was_noisy',
      'other',
    ]);
  });

  it('breaks exit-stage ties on the order it is given', () => {
    const rows = [loss('installed', 'price'), loss('contacted', 'price')];
    expect(
      summariseLosses(rows, trackStages('design_partner')).byExitStage.map(
        (s) => s.key,
      ),
    ).toEqual(['contacted', 'installed']);
    // The same two rows, ordered by a list that puts them the other way round.
    expect(
      summariseLosses(rows, ['installed', 'contacted']).byExitStage.map(
        (s) => s.key,
      ),
    ).toEqual(['installed', 'contacted']);
  });

  it('groups by exit stage as well as by reason', () => {
    const { byExitStage } = summariseLosses(MIXED);
    expect(byExitStage[0]).toEqual({
      key: 'installed',
      count: 3,
      share: 3 / 8,
    });
    expect(byExitStage).toHaveLength(6);
  });

  /*
   * The number the funnel is actually for: four of these eight prospects were
   * reached and then lost by the product, not by the outreach.
   */
  it('splits acquisition from activation', () => {
    expect(summariseLosses(MIXED).byPhase).toEqual({
      acquisition: 4,
      activation: 4,
    });
  });

  it('every phase count sums to the total', () => {
    const { total, byPhase } = summariseLosses(MIXED);
    expect(byPhase.acquisition + byPhase.activation).toBe(total);
  });

  it('shares sum to one', () => {
    const { byReason, byExitStage } = summariseLosses(MIXED);
    const sum = (xs: { share: number }[]) =>
      xs.reduce((t, x) => t + x.share, 0);
    expect(sum(byReason)).toBeCloseTo(1, 10);
    expect(sum(byExitStage)).toBeCloseTo(1, 10);
  });

  it('reports the unclassified share as a number, not a verdict', () => {
    const summary = summariseLosses(MIXED);
    expect(summary.unclassified).toBe(1);
    expect(summary.unclassifiedShare).toBeCloseTo(1 / 8, 10);
    expect(summary).not.toHaveProperty('taxonomyIncomplete');
  });

  it('reports a taxonomy that has stopped fitting as a share near one', () => {
    const summary = summariseLosses([
      loss('contacted', 'other'),
      loss('replied', 'other'),
      loss('interested', 'other'),
      loss('installed', 'price'),
    ]);
    expect(summary.unclassifiedShare).toBeCloseTo(0.75, 10);
    expect(summary.byReason[0]?.key).toBe('other');
  });
});
