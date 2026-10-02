/**
 * How far a workspace is from its first health check, as a sequence of steps.
 *
 * ## This used to lead somewhere else, and that was the defect
 *
 * It had six steps ending at "open the first pull request" with the CLI, which
 * described the legacy `extract → translate → PR` pipeline. That pipeline still
 * works and is still reachable, but it is not what Layersky is: the product is
 * a guardrail that watches pull requests and reports what they break.
 *
 * The guardrail needs **none** of the four steps that followed GitHub. It reads
 * no project row, needs no CLI token, starts no run. It reacts to the App
 * installation, so the honest path is three steps — workspace, GitHub, and the
 * first check arriving on its own. Everything else is now presented as what it
 * is: another way in, not the way.
 *
 * This is deliberately *not* `lib/metrics/funnel.ts`, and the difference is the
 * whole point of the file. The funnel answers "how many" — it is a measurement
 * surface, and it reports counts. This answers "what now", which is a different
 * question with a different failure mode: a count can be zero and still be
 * true, but a next step that is wrong sends someone down a path that cannot
 * work.
 *
 * Both read the same rows. Neither invents one.
 *
 * **Every status here is derived from something the database already holds**,
 * or from a refusal the deployment can state about itself. Nothing is stored to
 * track progress: an `onboarding_state` column would be a second account of
 * facts the other tables already carry, free to disagree with them — and the
 * disagreement would show up as a checklist insisting you connect a repository
 * you connected an hour ago.
 *
 * ## Tone is not decoration here
 *
 * DESIGN.md §6.3 draws the line this file has to respect: colour reports the
 * state of something that *exists*. A step nobody has reached yet has no state,
 * so it gets no tone — painting it amber would claim its behaviour is degraded,
 * and painting it Iris would claim a person must decide about it. Both describe
 * the absence of a thing rather than the state of one.
 *
 * So exactly four tones are reachable, and each has to be earned:
 *
 *  - `confident` — the step is done, and a row proves it.
 *  - `failed` — something exists and refuses: a deployment that cannot offer
 *    the GitHub flow, a run that failed.
 *  - `ambiguous` — **your judgement is required**, and nothing else. Reached
 *    only by a run that stopped to ask a question (§1.4).
 *  - none — not reached yet, or in progress.
 */

/** The run columns this file reads. Same shape as `lib/metrics/funnel.ts`. */
export interface OnboardingRun {
  status:
    | 'queued'
    | 'running'
    | 'succeeded'
    | 'partial'
    | 'failed'
    | 'awaiting_review'
    | 'no_changes';
  pr_url: string | null;
}

/** A project, in the columns that decide whether it can produce a run. */
export interface OnboardingProject {
  slug: string;
  name: string;
  repositoryOwner: string | null;
  repositoryName: string | null;
  baseBranch: string;
  targetLocales: readonly string[];
}

export interface OnboardingInput {
  orgSlug: string;
  workspaceName: string;
  /** Null when this workspace has never connected GitHub. */
  githubAccountLogin: string | null;
  /**
   * Environment variables the deployment is missing, from `installBlockers()`.
   * Non-empty means the flow cannot be offered at all — which is a present
   * failure of this deployment, not a step the user has yet to take.
   */
  githubBlockers: readonly string[];
  projects: readonly OnboardingProject[];
  /** Tokens that are neither expired nor revoked. */
  activeTokens: number;
  runs: readonly OnboardingRun[];
  /**
   * Health checks this workspace has received, from `i18n_checks`.
   *
   * A count, not the rows: this file decides "what now", and the answer turns
   * on whether any check has ever arrived. What those checks *found* is the
   * health screen's question, and reading it here would put a second opinion
   * about the same rows on a second surface.
   */
  healthChecks: number;
}

export type StepId = 'workspace' | 'github' | 'health_check';

export type StepStatus = 'done' | 'current' | 'todo' | 'blocked';

/** Only the tones §6.1 defines, and only when something exists to report on. */
export type StepTone = 'confident' | 'failed' | 'ambiguous' | null;

export interface OnboardingStep {
  id: StepId;
  title: string;
  status: StepStatus;
  tone: StepTone;
  /**
   * What this step produced, once it has. Null while it has not — never a
   * placeholder, because "—" in the same slot where a real value appears reads
   * as a value.
   */
  detail: string | null;
  /** Why it is blocked, in the reader's terms. Null unless blocked. */
  problem: string | null;
}

export interface Onboarding {
  steps: OnboardingStep[];
  done: number;
  total: number;
  /** The step the reader should act on, or null once everything is done. */
  current: StepId | null;
  /** True once a health check has arrived: the whole point of the path. */
  activated: boolean;
  /**
   * The project a shell command should be built for, or null.
   *
   * The first project that has both a repository and at least one target
   * locale — the two things `startRun` and `--open-pr` each refuse without.
   * Picking a project that is missing either would hand the reader a command
   * that cannot succeed.
   */
  commandProject: OnboardingProject | null;
}

const TITLES: Record<StepId, string> = {
  workspace: 'Create a workspace',
  github: 'Connect GitHub',
  health_check: 'Get your first health check',
};

/** A project that could actually produce a pull request. */
function usable(project: OnboardingProject): boolean {
  return (
    project.repositoryOwner !== null &&
    project.repositoryName !== null &&
    project.targetLocales.length > 0
  );
}

export function buildOnboarding(input: OnboardingInput): Onboarding {
  const connected = input.githubAccountLogin !== null;
  const deploymentCannotConnect = input.githubBlockers.length > 0;

  /*
   * Built as (done, tone, detail, problem) per step, then sequenced. Splitting
   * "is it done" from "is it the one to act on" matters: the current step is a
   * property of the *list* — the first one not done — and deciding it inside
   * each step is how a checklist ends up with two current items or none.
   */
  const raw: {
    id: StepId;
    done: boolean;
    tone: StepTone;
    detail: string | null;
    problem: string | null;
  }[] = [
    {
      id: 'workspace',
      // Reaching this page at all means one exists: the route is under
      // `/[org]`, and `/onboarding` refuses to move on without one.
      done: true,
      tone: 'confident',
      detail: input.workspaceName,
      problem: null,
    },
    {
      id: 'github',
      done: connected,
      tone: connected ? 'confident' : deploymentCannotConnect ? 'failed' : null,
      detail: connected ? input.githubAccountLogin : null,
      problem:
        !connected && deploymentCannotConnect
          ? `This deployment cannot offer the GitHub connection: ${input.githubBlockers.join(', ')} ${input.githubBlockers.length === 1 ? 'is' : 'are'} not set. Nobody can connect an account until an operator sets ${input.githubBlockers.length === 1 ? 'it' : 'them'}.`
          : null,
    },
    {
      id: 'health_check',
      done: input.healthChecks > 0,
      /*
       * Confident once one has arrived, and nothing before that.
       *
       * Not amber while waiting: a workspace that has connected GitHub and not
       * yet opened a pull request is not degraded, it simply has not been
       * asked anything. DESIGN.md §6.3 — a thing that has not happened has no
       * state.
       */
      tone: input.healthChecks > 0 ? 'confident' : null,
      detail:
        input.healthChecks > 0
          ? `${input.healthChecks} check${input.healthChecks === 1 ? '' : 's'}`
          : null,
      problem: null,
    },
  ];

  const firstUndone = raw.find((step) => !step.done);
  const steps: OnboardingStep[] = raw.map((step) => ({
    id: step.id,
    title: TITLES[step.id],
    status: step.done
      ? 'done'
      : step.problem !== null
        ? 'blocked'
        : step.id === firstUndone?.id
          ? 'current'
          : 'todo',
    tone: step.tone,
    detail: step.detail,
    problem: step.problem,
  }));

  return {
    steps,
    done: raw.filter((step) => step.done).length,
    total: raw.length,
    current: firstUndone?.id ?? null,
    /*
     * Activation is the first check, not the first pull request.
     *
     * It was `runsWithPr.length > 0`, which is the legacy pipeline's finish
     * line. A workspace can now be fully working — GitHub connected, every
     * pull request checked — without ever starting a run, and under the old
     * definition it would have been told it had not arrived.
     */
    activated: input.healthChecks > 0,
    commandProject: input.projects.find(usable) ?? null,
  };
}
