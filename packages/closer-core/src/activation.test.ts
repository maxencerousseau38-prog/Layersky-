import { describe, expect, it } from 'vitest';
import {
  ACTIVATION_MILESTONES,
  ACTIVATION_THRESHOLDS,
  type ActivationMetrics,
  deriveActivation,
  suggestedActivationStage,
} from './activation.js';

/** A linked workspace that has done everything the rows can show. */
const ACTIVE: ActivationMetrics = {
  activatedOrganizationId: 'org-1',
  installedAt: '2026-10-01T10:00:00Z',
  firstCheckAt: '2026-10-02T09:00:00Z',
  lastCheckAt: '2026-10-06T11:00:00Z',
  checksTotal: 11,
  distinctCheckDays: 4,
  distinctPullRequests: 7,
  repositoriesChecked: 3,
  correctionsApplied: 2,
  hasPaidSubscription: false,
};

describe('deriveActivation', () => {
  it('reports every milestone, always, in track order', () => {
    const status = deriveActivation(ACTIVE);
    expect(status.milestones.map((m) => m.milestone)).toEqual([
      ...ACTIVATION_MILESTONES,
    ]);
  });

  /* ---- unlinked ---- */

  /*
   * The distinction the whole module rests on. An unlinked lead has not failed
   * to install — it has not been matched yet, which is the operator's
   * bookkeeping rather than the prospect's behaviour.
   */
  it('says nothing is derivable when no workspace is linked', () => {
    for (const status of [
      deriveActivation(null),
      deriveActivation({ ...ACTIVE, activatedOrganizationId: null }),
    ]) {
      expect(status.linked).toBe(false);
      expect(status.derivedStage).toBeNull();
      expect(status.notDerivable).toEqual([...ACTIVATION_MILESTONES]);
      for (const verdict of status.milestones) {
        expect(verdict.state).toBe('not_derivable');
        expect(verdict.state).not.toBe('not_reached');
      }
    }
  });

  /* ---- installed ---- */

  it('reads the installation timestamp as installed', () => {
    const installed = deriveActivation(ACTIVE).milestones[0];
    expect(installed?.state).toBe('reached');
    expect(installed?.at).toBe('2026-10-01T10:00:00Z');
  });

  /*
   * A linked workspace with no installation is a real state: the match is
   * confirmed from an installation that existed, and an owner can uninstall on
   * GitHub afterwards, which `forget_github_installation` records by deleting
   * the row.
   */
  it('reports an uninstalled workspace as not reached, and says it may have been uninstalled', () => {
    const status = deriveActivation({ ...ACTIVE, installedAt: null });
    const installed = status.milestones[0];
    expect(installed?.state).toBe('not_reached');
    expect(installed?.why).toMatch(/uninstalled/i);
    expect(status.derivedStage).toBeNull();
  });

  /* ---- first_check ---- */

  it('names the most informative failure: installed, never checked', () => {
    const status = deriveActivation({
      ...ACTIVE,
      firstCheckAt: null,
      lastCheckAt: null,
      checksTotal: 0,
      distinctCheckDays: 0,
      distinctPullRequests: 0,
      repositoriesChecked: 0,
      correctionsApplied: 0,
    });
    expect(status.derivedStage).toBe('installed');
    expect(status.milestones[1]?.state).toBe('not_reached');
    expect(status.milestones[1]?.why).toMatch(/no check has run/i);
  });

  /* ---- repeated_usage ---- */

  it('needs both dimensions, not either', () => {
    // Ten checks on one pull request in one day: a team debugging an install.
    const oneBurst = deriveActivation({
      ...ACTIVE,
      checksTotal: 10,
      distinctCheckDays: 1,
      distinctPullRequests: 1,
    });
    expect(oneBurst.milestones[2]?.state).toBe('not_reached');

    // Several days but still one pull request.
    const oneePr = deriveActivation({
      ...ACTIVE,
      checksTotal: 5,
      distinctCheckDays: 3,
      distinctPullRequests: 1,
    });
    expect(oneePr.milestones[2]?.state).toBe('not_reached');

    // One day, several pull requests: still a single sitting.
    const oneDay = deriveActivation({
      ...ACTIVE,
      checksTotal: 5,
      distinctCheckDays: 1,
      distinctPullRequests: 4,
    });
    expect(oneDay.milestones[2]?.state).toBe('not_reached');
  });

  it('is reached exactly at the threshold', () => {
    const atThreshold = deriveActivation({
      ...ACTIVE,
      checksTotal: 2,
      distinctCheckDays: ACTIVATION_THRESHOLDS.repeatedUsageMinDays,
      distinctPullRequests: ACTIVATION_THRESHOLDS.repeatedUsageMinPullRequests,
    });
    expect(atThreshold.milestones[2]?.state).toBe('reached');
  });

  it('quotes both the observation and the threshold, so the verdict can be argued with', () => {
    const why = deriveActivation(ACTIVE).milestones[2]?.why ?? '';
    expect(why).toContain('4 day(s)');
    expect(why).toContain('7 pull request(s)');
    expect(why).toContain(
      `${ACTIVATION_THRESHOLDS.repeatedUsageMinDays} day(s)`,
    );
  });

  it('honours custom thresholds', () => {
    const strict = deriveActivation(ACTIVE, {
      repeatedUsageMinDays: 10,
      repeatedUsageMinPullRequests: 10,
    });
    expect(strict.milestones[2]?.state).toBe('not_reached');
    expect(strict.derivedStage).toBe('first_check');
  });

  /*
   * No timestamp, deliberately. "When did repeated usage start" is a threshold
   * crossed between the first check and the last, not a moment any row holds —
   * and reporting `lastCheckAt` would date something that did not happen then.
   */
  it('gives repeated usage no timestamp', () => {
    expect(deriveActivation(ACTIVE).milestones[2]?.at).toBeNull();
  });

  /* ---- pricing ---- */

  it('never claims to know about pricing', () => {
    for (const metrics of [ACTIVE, { ...ACTIVE, hasPaidSubscription: true }]) {
      const pricing = deriveActivation(metrics).milestones[3];
      expect(pricing?.milestone).toBe('pricing');
      expect(pricing?.state).toBe('not_derivable');
      expect(pricing?.why).toMatch(/operator judgement/i);
    }
  });

  /* ---- paid ---- */

  /*
   * The clause that stops this lying. `stripe_subscription_id` exists as a
   * column and nothing writes it, so its absence is not evidence of anything.
   * `not_reached` would report every design partner as having declined to pay.
   */
  it('reports paid as not derivable rather than not reached', () => {
    const paid = deriveActivation(ACTIVE).milestones[4];
    expect(paid?.state).toBe('not_derivable');
    expect(paid?.state).not.toBe('not_reached');
    expect(paid?.why).toMatch(/absence proves nothing/i);
    expect(deriveActivation(ACTIVE).notDerivable).toContain('paid');
  });

  it('reports paid as reached when a subscription id exists', () => {
    // The model, ready for the day billing exists. No row has one today.
    const paid = deriveActivation({
      ...ACTIVE,
      hasPaidSubscription: true,
    }).milestones[4];
    expect(paid?.state).toBe('reached');
  });

  /* ---- derivedStage ---- */

  it('stops at the first beat that is not reached, rather than skipping a hole', () => {
    // An installation and a subscription but no check: `installed`, with
    // something odd going on — not `paid`.
    const status = deriveActivation({
      ...ACTIVE,
      firstCheckAt: null,
      checksTotal: 0,
      distinctCheckDays: 0,
      distinctPullRequests: 0,
      hasPaidSubscription: true,
    });
    expect(status.derivedStage).toBe('installed');
  });

  it('never derives a stage whose evidence is not derivable', () => {
    // `pricing` is always not_derivable, so the chain can never reach `paid`
    // from product rows alone however complete they are.
    const status = deriveActivation({ ...ACTIVE, hasPaidSubscription: true });
    expect(status.derivedStage).toBe('repeated_usage');
    expect(status.derivedStage).not.toBe('pricing');
    expect(status.derivedStage).not.toBe('paid');
  });

  it('derives repeated_usage for the fully active workspace', () => {
    expect(deriveActivation(ACTIVE).derivedStage).toBe('repeated_usage');
  });

  /* ---- shape ---- */

  it('every verdict carries a reason', () => {
    for (const metrics of [
      ACTIVE,
      { ...ACTIVE, installedAt: null },
      { ...ACTIVE, activatedOrganizationId: null },
    ]) {
      for (const verdict of deriveActivation(metrics).milestones) {
        expect(verdict.why.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('suggestedActivationStage', () => {
  it('suggests the derived stage when the lead is behind it', () => {
    const status = deriveActivation(ACTIVE);
    expect(suggestedActivationStage('installed', status)).toBe(
      'repeated_usage',
    );
  });

  /*
   * The case this subsystem earns its keep on: a prospect installed and ran
   * checks while the lead still said `interested`, because nobody was watching.
   * `interested` is not on the activation chain, so it must read as behind all
   * of it rather than as unknown.
   */
  it('suggests a move for a lead not yet on the activation chain', () => {
    const status = deriveActivation(ACTIVE);
    expect(suggestedActivationStage('interested', status)).toBe(
      'repeated_usage',
    );
    expect(suggestedActivationStage('contacted', status)).toBe(
      'repeated_usage',
    );
  });

  it('suggests nothing when the lead is already there', () => {
    const status = deriveActivation(ACTIVE);
    expect(suggestedActivationStage('repeated_usage', status)).toBeNull();
  });

  /*
   * Never backwards. A lead at `pricing` whose checks stopped has not returned
   * to `first_check` — it is a conversation that outlived its usage, and
   * `closer_set_stage` would refuse the edge anyway because the graph has no
   * path back down the chain.
   */
  it('never suggests a move backwards', () => {
    const status = deriveActivation(ACTIVE);
    expect(suggestedActivationStage('pricing', status)).toBeNull();
    expect(suggestedActivationStage('paid', status)).toBeNull();
  });

  it('suggests nothing for an unlinked lead', () => {
    expect(
      suggestedActivationStage('interested', deriveActivation(null)),
    ).toBeNull();
  });

  it('suggests nothing when the linked workspace has done nothing', () => {
    const status = deriveActivation({
      ...ACTIVE,
      installedAt: null,
      firstCheckAt: null,
      checksTotal: 0,
      distinctCheckDays: 0,
      distinctPullRequests: 0,
    });
    expect(status.derivedStage).toBeNull();
    expect(suggestedActivationStage('interested', status)).toBeNull();
  });
});
