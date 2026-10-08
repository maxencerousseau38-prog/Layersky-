import type { CloserStage } from './stages.js';

/**
 * Which activation milestones a linked workspace has actually reached.
 *
 * ## Derived, never stored
 *
 * Nothing here records a milestone. `organization_github_installations` already
 * knows when the App was connected and `i18n_checks` already has one row per
 * checked commit, so `installed`, `first_check` and `repeated_usage` are
 * arithmetic over rows the product writes anyway. A table carrying its own
 * `installed_at` would be a second account of the same facts, free to disagree
 * — the reason `lib/onboarding/steps.ts` stores no state either, and the reason
 * `/[org]/usage` reads `api_usage_daily` rather than recounting from `runs`.
 *
 * ## Three answers, not two
 *
 * A milestone is `reached`, `not_reached`, or `not_derivable`. The third is the
 * one that matters: `pricing` happens in a conversation and no table records
 * it, and `paid` has a column shape (`stripe_subscription_id`) with no writer,
 * no integration and zero rows. Reporting either as `not_reached` would assert
 * a measurement nobody took — the same failure `scoreIcp` avoids by listing its
 * unmeasured components at zero and saying so, rather than quietly scoring out
 * of seventy and presenting it out of a hundred.
 *
 * So `not_reached` means "we looked and it has not happened". `not_derivable`
 * means "nothing here can tell you". A funnel that confuses the two will report
 * every design partner as having refused to pay.
 */

export type MilestoneState = 'reached' | 'not_reached' | 'not_derivable';

/** The five beats of the design-partner track's activation half. */
export const ACTIVATION_MILESTONES = [
  'installed',
  'first_check',
  'repeated_usage',
  'pricing',
  'paid',
] as const satisfies readonly CloserStage[];

export type ActivationMilestone = (typeof ACTIVATION_MILESTONES)[number];

/**
 * What `closer_activation_metrics` returns, and nothing more.
 *
 * Counters and timestamps. No repository name, no pull request number, no
 * finding, no title, no summary, no locale — those belong to the prospect and
 * they did not agree to an operator reading them. The number of repositories
 * is an activation signal; the name of one is somebody else's code.
 */
export interface ActivationMetrics {
  /** Null when no workspace is linked to the lead. */
  activatedOrganizationId: string | null;
  installedAt: string | null;
  firstCheckAt: string | null;
  lastCheckAt: string | null;
  checksTotal: number;
  distinctCheckDays: number;
  distinctPullRequests: number;
  repositoriesChecked: number;
  correctionsApplied: number;
  /**
   * Whether the workspace has a subscription id. Modelled against the column a
   * payment would write; false for everybody today, because nothing writes it.
   */
  hasPaidSubscription: boolean;
}

/**
 * What separates coming back from trying once.
 *
 * Two dimensions, because one is not enough. Ten checks on one pull request in
 * one afternoon is a team debugging their first install; two checks on two pull
 * requests on two different days is a team that let it run and came back. The
 * transition note in the migration says exactly this — "checks on several pull
 * requests, over several days" — and these are those two words as numbers.
 *
 * Two, not three. The threshold's job is to rule out "installed, ran once,
 * never again", and the measured fixture on the operator's own workspace sits
 * at 11 checks across 4 days and 7 pull requests. Raising it would start
 * reporting genuinely engaged partners as un-activated, which is the expensive
 * direction of this error: it would hide the thing being validated.
 *
 * Configurable rather than compiled in, so a figure can move with a reason
 * instead of a redeploy — the same reason `DEFAULT_ICP_WEIGHTS` is a constant.
 */
export interface ActivationThresholds {
  repeatedUsageMinDays: number;
  repeatedUsageMinPullRequests: number;
}

/*
 * Annotated, not `as const`.
 *
 * `as const` gave the fields the literal types `2` and `2`, so the parameter
 * typed `typeof ACTIVATION_THRESHOLDS` accepted nothing but the default —
 * "configurable rather than compiled in" that no caller could configure. The
 * compiler said so the first time a test passed 10.
 */
export const ACTIVATION_THRESHOLDS: ActivationThresholds = {
  repeatedUsageMinDays: 2,
  repeatedUsageMinPullRequests: 2,
};

export interface MilestoneVerdict {
  milestone: ActivationMilestone;
  state: MilestoneState;
  /** The observation behind the verdict, in the terms an operator can check. */
  why: string;
  /** When it happened, where a timestamp exists. */
  at: string | null;
}

export interface ActivationStatus {
  linked: boolean;
  milestones: MilestoneVerdict[];
  /**
   * The furthest stage the product's own rows support, or null when they
   * support none. Never a stage whose evidence is `not_derivable`.
   */
  derivedStage: CloserStage | null;
  /** Milestones no data can speak to, named rather than silently false. */
  notDerivable: ActivationMilestone[];
}

/**
 * Nothing is linked, so nothing is known — and that is distinct from zero.
 *
 * Every milestone is `not_derivable` rather than `not_reached`: an unlinked
 * lead has not failed to install, it has not been matched to a workspace yet.
 * Reporting `not_reached` here would make an operator's unfinished bookkeeping
 * look like a prospect's refusal.
 */
function unlinked(): ActivationStatus {
  return {
    linked: false,
    milestones: ACTIVATION_MILESTONES.map((milestone) => ({
      milestone,
      state: 'not_derivable' as const,
      why: 'No workspace is linked to this lead yet',
      at: null,
    })),
    derivedStage: null,
    notDerivable: [...ACTIVATION_MILESTONES],
  };
}

export function deriveActivation(
  metrics: ActivationMetrics | null,
  thresholds: ActivationThresholds = ACTIVATION_THRESHOLDS,
): ActivationStatus {
  if (metrics === null || metrics.activatedOrganizationId === null) {
    return unlinked();
  }

  const milestones: MilestoneVerdict[] = [];

  /* ---- installed ---- */

  milestones.push(
    metrics.installedAt !== null
      ? {
          milestone: 'installed',
          state: 'reached',
          why: 'The GitHub App is connected to the linked workspace',
          at: metrics.installedAt,
        }
      : {
          milestone: 'installed',
          state: 'not_reached',
          /*
           * A linked workspace with no installation is a real state, not a
           * contradiction: the match is confirmed from an installation that
           * existed, and an owner can uninstall on GitHub afterwards — which
           * `forget_github_installation` records by deleting the row.
           */
          why: 'The linked workspace has no GitHub installation. It may have been uninstalled',
          at: null,
        },
  );

  /* ---- first_check ---- */

  milestones.push(
    metrics.firstCheckAt !== null
      ? {
          milestone: 'first_check',
          state: 'reached',
          why: `A check has run (${metrics.checksTotal} total)`,
          at: metrics.firstCheckAt,
        }
      : {
          milestone: 'first_check',
          state: 'not_reached',
          /*
           * The most informative failure this funnel records. Installed and
           * never checked says the problem is not reach, not the pitch and not
           * the price — it is that nothing happened after the install, which no
           * amount of outreach fixes.
           */
          why: 'No check has run on any of their pull requests',
          at: null,
        },
  );

  /* ---- repeated_usage ---- */

  const days = metrics.distinctCheckDays;
  const pulls = metrics.distinctPullRequests;
  const repeated =
    days >= thresholds.repeatedUsageMinDays &&
    pulls >= thresholds.repeatedUsageMinPullRequests;

  milestones.push({
    milestone: 'repeated_usage',
    state: repeated ? 'reached' : 'not_reached',
    why: `${metrics.checksTotal} check(s) across ${days} day(s) and ${pulls} pull request(s); repeated usage needs ${thresholds.repeatedUsageMinDays} day(s) and ${thresholds.repeatedUsageMinPullRequests} pull request(s)`,
    /*
     * No timestamp. "When did repeated usage start" is not a moment any row
     * holds — it is a threshold crossed somewhere between the first check and
     * the last, and picking `lastCheckAt` would report a date for something
     * that did not happen on it.
     */
    at: null,
  });

  /* ---- pricing: nothing records it ---- */

  milestones.push({
    milestone: 'pricing',
    state: 'not_derivable',
    why: 'Nothing records a pricing conversation. This is an operator judgement, moved on the lead by hand',
    at: null,
  });

  /* ---- paid: a column with no writer ---- */

  milestones.push({
    milestone: 'paid',
    state: metrics.hasPaidSubscription ? 'reached' : 'not_derivable',
    why: metrics.hasPaidSubscription
      ? 'The workspace carries a subscription id'
      : 'No billing exists in this product: `stripe_subscription_id` has no writer, so absence proves nothing',
    at: null,
  });

  /*
   * The furthest stage the rows support, walked in order and stopping at the
   * first beat that is not `reached`.
   *
   * Stopping rather than taking the furthest reached one: a workspace with an
   * installation, no checks, and somehow a subscription is not at `paid`, it is
   * at `installed` with something odd going on. Skipping a hole would report
   * progress through a stage that never happened.
   */
  let derivedStage: CloserStage | null = null;
  for (const verdict of milestones) {
    if (verdict.state !== 'reached') break;
    derivedStage = verdict.milestone;
  }

  return {
    linked: true,
    milestones,
    derivedStage,
    notDerivable: milestones
      .filter((m) => m.state === 'not_derivable')
      .map((m) => m.milestone),
  };
}

/**
 * The move to offer an operator, or null.
 *
 * Only ever **forward**, and only to a stage the rows support. Two reasons it
 * never moves a lead backwards: a lead at `pricing` whose checks stopped has
 * not returned to `first_check`, it is a conversation that outlived its usage;
 * and `closer_set_stage` would refuse the edge anyway, because the graph has no
 * path back down the activation chain.
 *
 * It suggests rather than acts. The stage is still written by
 * `closer_set_stage` with a reason, by a person — the same shape as the
 * approval gate, for the same reason: a funnel that advances itself is a funnel
 * whose numbers nobody can account for.
 */
export function suggestedActivationStage(
  current: CloserStage,
  status: ActivationStatus,
): CloserStage | null {
  if (status.derivedStage === null) return null;

  const order = ACTIVATION_MILESTONES as readonly CloserStage[];
  const derivedAt = order.indexOf(status.derivedStage);
  const currentAt = order.indexOf(current);

  /*
   * A lead not yet on the activation chain is handled too. `interested` is not
   * in `order`, so `currentAt` is -1 and any derived milestone is ahead of it —
   * which is right: a prospect who installed while the lead still said
   * `interested` is at `installed`, and that is the most common way this
   * subsystem earns its keep.
   */
  if (derivedAt <= currentAt) return null;
  return status.derivedStage;
}
