import type { RepositoryAccess } from '@localize-infra/github-app';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceCaller } from '../callers.js';
import {
  type GitHubAppOperations,
  openPrRouteHandler,
  preflightRouteHandler,
} from './route.js';

/**
 * A personal CLI token acts for one workspace, through that workspace's GitHub
 * installation, and nowhere else.
 *
 * Before this, the API opened every CLI pull request through the operator's
 * default installation — which reached the product's own repository — and a
 * repository outside it failed after translation had been paid for, with
 * "Check server logs for details".
 */

const DEFAULT_INSTALLATION = 456;
const WORKSPACE_INSTALLATION = 789;

const env = {
  app: { appId: '123', privateKey: 'fake-key' },
  defaultInstallationId: DEFAULT_INSTALLATION,
};

const body = {
  owner: 'acme',
  repo: 'widgets',
  baseBranch: 'main',
  title: 'Add translations',
  body: 'Automated',
  files: [{ path: 'locales/de.json', content: '{}' }],
};

const target = { owner: 'acme', repo: 'widgets', baseBranch: 'main' };

function workspace(overrides: Partial<WorkspaceCaller> = {}): WorkspaceCaller {
  return {
    kind: 'workspace',
    tokenId: 't',
    userId: 'u',
    organizationId: 'o',
    organizationSlug: 'acme-co',
    installationId: WORKSPACE_INSTALLATION,
    privateRepositories: false,
    ...overrides,
  };
}

function ops(
  access: RepositoryAccess = {
    ok: true,
    private: false,
    defaultBranch: 'main',
  },
  overrides: Partial<GitHubAppOperations> = {},
) {
  return {
    createClient: vi.fn(async () => ({}) as never),
    openPr: vi.fn(async () => ({
      opened: true as const,
      prUrl: 'https://github.com/acme/widgets/pull/7',
      prNumber: 7,
    })),
    checkAccess: vi.fn(async () => access),
    ...overrides,
  } satisfies GitHubAppOperations;
}

afterEach(() => vi.restoreAllMocks());

const errorOf = (result: { body: unknown }) =>
  (result.body as { error: string }).error;

describe('open-pr for a workspace token', () => {
  it('acts through the workspace installation, never the default', async () => {
    const o = ops();
    const result = await openPrRouteHandler(body, env, o, workspace());
    expect(result.status).toBe(200);
    expect(o.createClient).toHaveBeenCalledWith(
      expect.objectContaining({ installationId: WORKSPACE_INSTALLATION }),
    );
    expect(o.createClient).not.toHaveBeenCalledWith(
      expect.objectContaining({ installationId: DEFAULT_INSTALLATION }),
    );
  });

  it('refuses a request that names another installation', async () => {
    const o = ops();
    const result = await openPrRouteHandler(
      { ...body, installationId: DEFAULT_INSTALLATION },
      env,
      o,
      workspace(),
    );
    expect(result.status).toBe(403);
    expect(o.createClient).not.toHaveBeenCalled();
  });

  it('accepts a request naming its own installation', async () => {
    const result = await openPrRouteHandler(
      { ...body, installationId: WORKSPACE_INSTALLATION },
      env,
      ops(),
      workspace(),
    );
    expect(result.status).toBe(200);
  });

  it('says where to connect GitHub when the workspace has not', async () => {
    const o = ops();
    const result = await openPrRouteHandler(
      body,
      env,
      o,
      workspace({ installationId: null }),
    );
    expect(result.status).toBe(412);
    expect(errorOf(result)).toMatch(/no GitHub connection/);
    expect(errorOf(result)).toContain('/acme-co/projects');
    // No fallback to the operator's installation.
    expect(o.createClient).not.toHaveBeenCalled();
  });

  it('names the repository and the fix when it is unreachable', async () => {
    const o = ops({ ok: false, reason: 'repository_unreachable' });
    const result = await openPrRouteHandler(body, env, o, workspace());
    expect(result.status).toBe(404);
    expect(errorOf(result)).toContain('acme/widgets');
    expect(errorOf(result)).toContain('workspace "acme-co"');
    expect(o.openPr).not.toHaveBeenCalled();
  });

  it('names the default branch when the base branch does not exist', async () => {
    const o = ops({
      ok: false,
      reason: 'branch_not_found',
      defaultBranch: 'trunk',
    });
    const result = await openPrRouteHandler(body, env, o, workspace());
    expect(result.status).toBe(422);
    expect(errorOf(result)).toContain('--base-branch trunk');
    expect(o.openPr).not.toHaveBeenCalled();
  });

  /*
   * Still 403, and the sentence changed on purpose.
   *
   * It read "limited to public repositories", which describes a plan ceiling.
   * Since `20261003000100` the entitlement follows the GitHub App
   * installation — connecting one grants it — so a caller reaching this has
   * none linked, and the remedy is a connection rather than a purchase. The
   * refusal itself is unchanged: this is still the last gate before a private
   * repository is written to.
   */
  it('refuses a private repository without the entitlement', async () => {
    const o = ops({ ok: true, private: true, defaultBranch: 'main' });
    const result = await openPrRouteHandler(body, env, o, workspace());
    expect(result.status).toBe(403);
    expect(errorOf(result)).toMatch(/no GitHub App installation connected/);
    expect(errorOf(result)).not.toMatch(/plan/i);
    expect(o.openPr).not.toHaveBeenCalled();
  });

  it('allows a private repository with the entitlement', async () => {
    const o = ops({ ok: true, private: true, defaultBranch: 'main' });
    const result = await openPrRouteHandler(
      body,
      env,
      o,
      workspace({ privateRepositories: true }),
    );
    expect(result.status).toBe(200);
  });

  it('describes a GitHub 403 during the write without echoing GitHub', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const o = ops(undefined, {
      openPr: vi.fn(async () => {
        throw Object.assign(new Error('secret-internal-detail'), {
          status: 403,
        });
      }),
    });
    const result = await openPrRouteHandler(body, env, o, workspace());
    expect(result.status).toBe(403);
    expect(errorOf(result)).toMatch(/contents and pull request write access/);
    expect(JSON.stringify(result.body)).not.toContain('secret-internal-detail');
  });
});

describe('preflight', () => {
  it('answers ok with the repository and its visibility', async () => {
    const result = await preflightRouteHandler(
      target,
      env,
      ops({ ok: true, private: false, defaultBranch: 'main' }),
      workspace(),
    );
    expect(result).toEqual({
      status: 200,
      body: {
        ok: true,
        repository: 'acme/widgets',
        baseBranch: 'main',
        private: false,
      },
    });
  });

  it('checks access once and writes nothing', async () => {
    const o = ops();
    await preflightRouteHandler(target, env, o, workspace());
    expect(o.checkAccess).toHaveBeenCalledTimes(1);
    expect(o.openPr).not.toHaveBeenCalled();
  });

  it('gives the same refusals as open-pr', async () => {
    const unreachable = await preflightRouteHandler(
      target,
      env,
      ops({ ok: false, reason: 'repository_unreachable' }),
      workspace(),
    );
    expect(unreachable.status).toBe(404);

    const noGitHub = await preflightRouteHandler(
      target,
      env,
      ops(),
      workspace({ installationId: null }),
    );
    expect(noGitHub.status).toBe(412);

    const privateRepo = await preflightRouteHandler(
      target,
      env,
      ops({ ok: true, private: true, defaultBranch: 'main' }),
      workspace(),
    );
    expect(privateRepo.status).toBe(403);
  });

  it('uses the default installation for the operator', async () => {
    const o = ops();
    const result = await preflightRouteHandler(target, env, o);
    expect(result.status).toBe(200);
    expect(o.createClient).toHaveBeenCalledWith(
      expect.objectContaining({ installationId: DEFAULT_INSTALLATION }),
    );
  });

  it('rejects an incomplete request', async () => {
    const result = await preflightRouteHandler(
      { owner: 'acme' },
      env,
      ops(),
      workspace(),
    );
    expect(result.status).toBe(400);
  });

  it('reports a GitHub failure by status only', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await preflightRouteHandler(
      target,
      env,
      ops(undefined, {
        checkAccess: vi.fn(async () => {
          throw Object.assign(new Error('rate limit internals'), {
            status: 500,
          });
        }),
      }),
      workspace(),
    );
    expect(result.status).toBe(502);
    expect(JSON.stringify(result.body)).not.toContain('rate limit internals');
  });
});
