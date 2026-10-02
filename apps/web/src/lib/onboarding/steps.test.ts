import { describe, expect, it } from 'vitest';
import {
  type OnboardingInput,
  type OnboardingProject,
  type OnboardingRun,
  buildOnboarding,
} from './steps.js';

/**
 * What the guided path is allowed to claim.
 *
 * Two rules carry most of these, and both are rules this repository has been
 * caught breaking elsewhere:
 *
 *  1. **A step nobody has reached has no state**, so it has no tone
 *     (DESIGN.md §6.3). Iris on "not done yet" is exactly the leak that reached
 *     five pages once already.
 *  2. **Nothing is invented.** Every "done" traces to a row the caller passed
 *     in; there is no stored progress flag that could disagree with the data.
 */

const project = (over: Partial<OnboardingProject> = {}): OnboardingProject => ({
  slug: 'web',
  name: 'Web',
  repositoryOwner: 'acme',
  repositoryName: 'site',
  baseBranch: 'main',
  targetLocales: ['fr', 'de'],
  ...over,
});

const run = (over: Partial<OnboardingRun> = {}): OnboardingRun => ({
  status: 'succeeded',
  pr_url: 'https://github.com/acme/site/pull/1',
  ...over,
});

const input = (over: Partial<OnboardingInput> = {}): OnboardingInput => ({
  orgSlug: 'acme',
  workspaceName: 'Acme',
  githubAccountLogin: null,
  githubBlockers: [],
  projects: [],
  activeTokens: 0,
  runs: [],
  healthChecks: 0,
  ...over,
});

const byId = (result: ReturnType<typeof buildOnboarding>, id: string) => {
  const step = result.steps.find((s) => s.id === id);
  if (!step) throw new Error(`no step ${id}`);
  return step;
};

describe('a brand-new workspace', () => {
  const fresh = buildOnboarding(input());

  it('has the workspace step done and nothing else', () => {
    expect(fresh.done).toBe(1);
    // Three, not six. The four CLI steps described the legacy pipeline, which
    // the health check needs none of — see the file's own docstring.
    expect(fresh.total).toBe(3);
    expect(byId(fresh, 'workspace').status).toBe('done');
  });

  it('points at connecting GitHub as the one thing to do next', () => {
    expect(fresh.current).toBe('github');
    expect(byId(fresh, 'github').status).toBe('current');
  });

  it('marks every later step todo, not current', () => {
    expect(byId(fresh, 'health_check').status).toBe('todo');
  });

  it('gives no tone to a step that has not been reached', () => {
    // DESIGN.md §6.3: a thing that does not exist yet has no state to report.
    // In particular a workspace waiting for its first check is not degraded.
    for (const id of ['github', 'health_check']) {
      expect(byId(fresh, id).tone, id).toBeNull();
    }
  });

  it('shows no detail rather than a placeholder', () => {
    expect(byId(fresh, 'github').detail).toBeNull();
    expect(byId(fresh, 'health_check').detail).toBeNull();
  });

  it('is not activated and offers no command project', () => {
    expect(fresh.activated).toBe(false);
    expect(fresh.commandProject).toBeNull();
  });
});

describe('exactly one step is current', () => {
  const cases: [string, OnboardingInput][] = [
    ['nothing done', input()],
    ['github only', input({ githubAccountLogin: 'acme' })],
    [
      'github connected, no check yet',
      input({ githubAccountLogin: 'acme', projects: [project()] }),
    ],
  ];

  for (const [name, given] of cases) {
    it(name, () => {
      const result = buildOnboarding(given);
      const current = result.steps.filter((s) => s.status === 'current');
      expect(current).toHaveLength(1);
      expect(current[0]?.id).toBe(result.current);
    });
  }

  /*
   * Done means a check has arrived, not that a pull request was opened.
   *
   * `activated` was `runsWithPr.length > 0` — the legacy finish line. A
   * workspace can be fully working now without ever starting a run, and the
   * old definition would have told it it had not arrived.
   */
  it('has none once a check has arrived', () => {
    const done = buildOnboarding(
      input({ githubAccountLogin: 'acme', healthChecks: 1 }),
    );
    expect(done.current).toBeNull();
    expect(done.steps.filter((s) => s.status === 'current')).toHaveLength(0);
    expect(done.done).toBe(3);
    expect(done.activated).toBe(true);
  });

  it('is not activated by a run that opened a pull request', () => {
    const cliOnly = buildOnboarding(
      input({
        githubAccountLogin: 'acme',
        projects: [project()],
        activeTokens: 1,
        runs: [run()],
      }),
    );
    expect(cliOnly.activated).toBe(false);
    expect(cliOnly.current).toBe('health_check');
  });
});

describe('a deployment that cannot offer the GitHub flow', () => {
  const blocked = buildOnboarding(
    input({ githubBlockers: ['GITHUB_APP_SLUG', 'GITHUB_OAUTH_CLIENT_ID'] }),
  );
  const step = byId(blocked, 'github');

  it('is blocked, not merely current', () => {
    expect(step.status).toBe('blocked');
  });

  it('is failed, because the refusal exists and is present today', () => {
    expect(step.tone).toBe('failed');
  });

  it('names the variables an operator would have to set', () => {
    expect(step.problem).toContain('GITHUB_APP_SLUG');
    expect(step.problem).toContain('GITHUB_OAUTH_CLIENT_ID');
    expect(step.problem).toContain('are not set');
  });

  it('uses the singular when only one is missing', () => {
    const one = buildOnboarding(input({ githubBlockers: ['GITHUB_APP_SLUG'] }));
    expect(byId(one, 'github').problem).toContain('is not set');
  });

  it('does not block once GitHub is connected', () => {
    const connected = buildOnboarding(
      input({ githubAccountLogin: 'acme', githubBlockers: ['ANYTHING'] }),
    );
    expect(byId(connected, 'github').status).toBe('done');
    expect(byId(connected, 'github').tone).toBe('confident');
  });
});

/*
 * The Iris rule, kept after the steps it was written against were removed.
 *
 * It used to be proved by a run waiting on a human decision — the one place in
 * the old six-step path that earned the colour. That step is gone, and the
 * rule is not: DESIGN.md §1.4 reserves Iris for "your judgement is required",
 * and nothing in a three-step path to a first check ever is. The check itself
 * has findings that need a judgement, and they are coloured on the health
 * screen, which is where the reader can act on them.
 */
describe('Iris', () => {
  it('appears nowhere in this path, in any state', () => {
    const states: OnboardingRun['status'][] = [
      'queued',
      'running',
      'succeeded',
      'partial',
      'failed',
      'awaiting_review',
      'no_changes',
    ];
    for (const status of states) {
      for (const checks of [0, 1]) {
        const result = buildOnboarding(
          input({
            githubAccountLogin: 'acme',
            runs: [run({ status, pr_url: null })],
            healthChecks: checks,
          }),
        );
        for (const step of result.steps) {
          expect(step.tone, `${status}/${checks}/${step.id}`).not.toBe(
            'ambiguous',
          );
        }
      }
    }
  });
});

describe('the project a command is built for', () => {
  it('is skipped when it has no repository', () => {
    const result = buildOnboarding(
      input({
        projects: [project({ repositoryOwner: null, repositoryName: null })],
      }),
    );
    expect(result.commandProject).toBeNull();
  });

  it('is skipped when it has no target locales', () => {
    // startRun refuses a project with no target locale before writing a row,
    // so a command built for one cannot succeed.
    const result = buildOnboarding(
      input({ projects: [project({ targetLocales: [] })] }),
    );
    expect(result.commandProject).toBeNull();
  });

  it('is the first project that can actually produce a pull request', () => {
    const result = buildOnboarding(
      input({
        projects: [
          project({ slug: 'empty', targetLocales: [] }),
          project({ slug: 'usable' }),
        ],
      }),
    );
    expect(result.commandProject?.slug).toBe('usable');
  });
});

describe('detail lines report rows, not intentions', () => {
  it('names the connected account', () => {
    const result = buildOnboarding(input({ githubAccountLogin: 'octo-corp' }));
    expect(byId(result, 'github').detail).toBe('octo-corp');
  });

  it('pluralises counts it prints', () => {
    expect(
      byId(buildOnboarding(input({ healthChecks: 1 })), 'health_check').detail,
    ).toBe('1 check');
    expect(
      byId(buildOnboarding(input({ healthChecks: 4 })), 'health_check').detail,
    ).toBe('4 checks');
  });
});
