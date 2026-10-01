import { describe, expect, it, vi } from 'vitest';
import { explainGitHubFailure } from './health.js';

/**
 * The branches a healthy account cannot produce on demand.
 *
 * This is why the explanation is a pure function rather than a `catch` block
 * inside the call: 404 (the installation was removed), 401 (the deployment's
 * App credentials are wrong) and 429 (GitHub is rate-limiting) are exactly the
 * states worth getting right and exactly the ones no test fixture can arrange
 * against real GitHub.
 *
 * What each assertion checks is not the wording but the *addressee*: whether
 * the sentence tells the reader to do something they can actually do. A
 * customer cannot fix an App private key, and telling them to reconnect when
 * GitHub is merely rate-limiting sends them to uninstall something that works.
 */

const withStatus = (status: number, message = 'from GitHub') =>
  Object.assign(new Error(message), { status });

describe('a failure the reader can fix', () => {
  it('404 means the installation is gone, so reconnecting is the fix', () => {
    const { problem } = explainGitHubFailure(withStatus(404));
    expect(problem).toMatch(/uninstalled|does not recognise/i);
    expect(problem).toMatch(/Connect GitHub again/i);
  });

  it('no repositories is not this branch — it is not an error at all', () => {
    // Guards the distinction rather than the sentence: an installation with no
    // repository selected is the commonest reason a "connected" workspace
    // still cannot open a pull request, and it is handled by the caller as a
    // successful call with nothing granted, not as a thrown error.
    const { problem } = explainGitHubFailure(withStatus(404));
    expect(problem).not.toMatch(/granted no repositories/i);
  });
});

describe('a failure only an operator can fix', () => {
  for (const status of [401, 403]) {
    it(`${status} says so, instead of sending a customer to GitHub`, () => {
      const { problem } = explainGitHubFailure(withStatus(status));
      expect(problem).toMatch(/operator problem/i);
      expect(problem).not.toMatch(/Connect GitHub again/i);
    });
  }
});

describe('a failure that is nobody’s fault', () => {
  it('429 tells the reader to wait, not to reconnect', () => {
    const { problem } = explainGitHubFailure(withStatus(429));
    expect(problem).toMatch(/rate-limiting/i);
    expect(problem).toMatch(/Nothing is wrong with your installation/i);
  });

  for (const status of [500, 502, 503]) {
    it(`${status} blames GitHub, not the installation`, () => {
      const { problem } = explainGitHubFailure(withStatus(status));
      expect(problem).toMatch(/GitHub itself/i);
      expect(problem).toMatch(/probably fine/i);
    });
  }

  it('an error with no status says the answer is unknown', () => {
    /*
     * The important half: "could not check" must not be reported as "broken".
     * A check that failed is not evidence about the thing it was checking —
     * the same rule the API applies when it answers 503 rather than letting a
     * request through.
     */
    const { problem } = explainGitHubFailure(new Error('socket hang up'));
    expect(problem).toMatch(/unknown/i);
    expect(problem).toMatch(/not evidence that it is broken/i);
  });
});

describe('the provider’s own words', () => {
  it('are carried through, because they are usually more specific', () => {
    expect(explainGitHubFailure(withStatus(404, 'Not Found')).detail).toBe(
      'Not Found',
    );
  });

  it('are null when the thrown thing is not an error', () => {
    for (const thrown of [null, undefined, 'a string', 42, {}]) {
      expect(explainGitHubFailure(thrown).detail, String(thrown)).toBeNull();
    }
  });

  it('never leaves a branch without a problem sentence', () => {
    for (const thrown of [
      null,
      undefined,
      {},
      new Error(''),
      withStatus(418),
      withStatus(404),
    ]) {
      const { problem } = explainGitHubFailure(thrown);
      expect(problem.length, String(thrown)).toBeGreaterThan(20);
    }
  });
});

/*
 * `readInstallationRepositories` is exercised through a stub of the module it
 * calls, because the interesting inputs are failures a healthy GitHub account
 * cannot be asked to produce: a deleted installation, an expired App key, a
 * rate limit. Each is a thrown Octokit-shaped error, which is exactly what the
 * real client raises.
 */
describe('readInstallationRepositories', () => {
  const httpError = (status: number, message = 'Not Found') =>
    Object.assign(new Error(message), { status });

  async function read(throws: unknown) {
    vi.resetModules();
    vi.doMock('./repositories', () => ({
      listInstallationRepositories: async () => {
        if (throws) throw throws;
        return [
          {
            owner: 'acme',
            name: 'shop',
            fullName: 'acme/shop',
            defaultBranch: 'main',
            private: false,
          },
        ];
      },
    }));
    const mod = await import('./health.js');
    return mod.readInstallationRepositories('org-1');
  }

  it('returns the repositories when GitHub answers', async () => {
    const access = await read(null);
    expect(access.ok).toBe(true);
    if (access.ok) expect(access.repositories).toHaveLength(1);
  });

  /*
   * The case this function exists for. Before it, a 404 propagated out of a
   * server component and the whole project page became an HTTP 500 with an
   * empty body — observed after the App was reinstalled and the stored
   * installation stopped existing.
   */
  it('does not throw when the installation is gone', async () => {
    const access = await read(httpError(404));
    expect(access.ok).toBe(false);
    if (!access.ok) {
      expect(access.reconnect).toBe(true);
      expect(access.problem).toMatch(/does not recognise this installation/i);
    }
  });

  /*
   * The guard that keeps the advice honest. None of these is fixed by
   * reconnecting: 401 and 403 are the *operator's* App credentials, 429 is a
   * rate limit, 5xx is GitHub itself. Offering "Reconnect GitHub" would send a
   * customer to redo work that was never broken.
   */
  it.each([401, 403, 429, 500, 502, 503])(
    'does not offer reconnect for %i',
    async (status) => {
      const access = await read(httpError(status, 'Boom'));
      expect(access.ok).toBe(false);
      if (!access.ok) expect(access.reconnect).toBe(false);
    },
  );

  /** A transport failure carries no status, and is not an installation problem. */
  it('does not offer reconnect for a network failure', async () => {
    const access = await read(new Error('fetch failed'));
    expect(access.ok).toBe(false);
    if (!access.ok) {
      expect(access.reconnect).toBe(false);
      expect(access.problem).toMatch(/not evidence that it is broken/i);
    }
  });

  /** An empty grant is success, not a failure: the call worked. */
  it('reports an installation with no repositories as ok and empty', async () => {
    vi.resetModules();
    vi.doMock('./repositories', () => ({
      listInstallationRepositories: async () => [],
    }));
    const mod = await import('./health.js');
    const access = await mod.readInstallationRepositories('org-1');
    expect(access.ok).toBe(true);
    if (access.ok) expect(access.repositories).toEqual([]);
  });
});
