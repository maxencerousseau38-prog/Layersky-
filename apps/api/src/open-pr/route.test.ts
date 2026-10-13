import { describe, expect, it, vi } from 'vitest';
import type { GitHubAppOperations } from './route.js';
import { openPrRouteHandler } from './route.js';

const validBody = {
  owner: 'acme',
  repo: 'widgets',
  baseBranch: 'main',
  title: 'Add translations',
  body: 'Automated',
  files: [{ path: 'locales/de.json', content: '{}' }],
};

const DEFAULT_INSTALLATION = 456;
const TENANT_INSTALLATION = 789;

const config = {
  app: { appId: '123', privateKey: 'fake-key' },
  defaultInstallationId: DEFAULT_INSTALLATION,
};

function fakeOps(
  overrides: Partial<GitHubAppOperations> = {},
): GitHubAppOperations {
  return {
    createClient: vi.fn(async () => ({}) as never),
    openPr: vi.fn(async () => ({
      opened: true as const,
      prUrl: 'https://github.com/acme/widgets/pull/1',
      prNumber: 1,
    })),
    ...overrides,
  };
}

describe('openPrRouteHandler', () => {
  it('returns 501 when no GitHub App config is available', async () => {
    const result = await openPrRouteHandler(
      validBody,
      { app: null, defaultInstallationId: DEFAULT_INSTALLATION },
      fakeOps(),
    );
    expect(result.status).toBe(501);
  });

  it('returns 400 for a request body that fails schema validation', async () => {
    const result = await openPrRouteHandler({ owner: 'a' }, config, fakeOps());
    expect(result.status).toBe(400);
  });

  it('returns 200 with the PR result when github-app succeeds', async () => {
    const result = await openPrRouteHandler(validBody, config, fakeOps());
    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      prUrl: 'https://github.com/acme/widgets/pull/1',
      prNumber: 1,
    });
  });

  /*
   * The regression test for blocker 2b.
   *
   * Nothing here asserted *which* installation the pull request came out of,
   * and the route had no way to be told: it passed its own configuration
   * straight to `createClient`. So every tenant's pull request was opened by
   * the operator's installation, and a customer with their own would have
   * translated and then failed at the last step. The suite passed throughout,
   * because "a pull request was opened" was the whole of what it checked.
   *
   * Asserting the negative alongside the positive is deliberate: with the
   * fallback still in place, an implementation that ignored the request field
   * would satisfy "called with an installation" and only this line catches it.
   */
  it('acts as the installation the request names, not the one it is configured with', async () => {
    const createClient = vi.fn(async () => ({}) as never);
    const result = await openPrRouteHandler(
      { ...validBody, installationId: TENANT_INSTALLATION },
      config,
      fakeOps({ createClient }),
    );

    expect(result.status).toBe(200);
    expect(createClient).toHaveBeenCalledWith(
      expect.objectContaining({ installationId: TENANT_INSTALLATION }),
    );
    expect(createClient).not.toHaveBeenCalledWith(
      expect.objectContaining({ installationId: DEFAULT_INSTALLATION }),
    );
  });

  it('carries the App credentials through unchanged when the request names an installation', async () => {
    const createClient = vi.fn(async () => ({}) as never);
    await openPrRouteHandler(
      { ...validBody, installationId: TENANT_INSTALLATION },
      config,
      fakeOps({ createClient }),
    );

    expect(createClient).toHaveBeenCalledWith({
      appId: '123',
      privateKey: 'fake-key',
      installationId: TENANT_INSTALLATION,
    });
  });

  /*
   * The single-tenant path: `packages/cli` runs against an `apps/api` the same
   * person operates, has exactly one installation, and sends no id. Requiring
   * the field would have broken it for no isolation gain.
   */
  it('falls back to the configured installation when the request names none', async () => {
    const createClient = vi.fn(async () => ({}) as never);
    const result = await openPrRouteHandler(
      validBody,
      config,
      fakeOps({ createClient }),
    );

    expect(result.status).toBe(200);
    expect(createClient).toHaveBeenCalledWith(
      expect.objectContaining({ installationId: DEFAULT_INSTALLATION }),
    );
  });

  /*
   * 409 rather than a 200 with a missing URL, because `@localize-infra/cli`
   * 0.1.0 is on npm and parses the 200 body with a schema that requires
   * `prUrl`. A widened body makes that published client throw a raw ZodError;
   * a non-2xx it already handles, and reports as a readable sentence.
   */
  it('returns 409 when there was nothing to open', async () => {
    const openPr = vi.fn(async () => ({
      opened: false as const,
      reason: 'no_changes' as const,
    }));

    const result = await openPrRouteHandler(
      validBody,
      {
        app: { appId: '123', privateKey: 'fake-key' },
        defaultInstallationId: 42,
      },
      fakeOps({ openPr }),
    );

    expect(result.status).toBe(409);
    expect(result.body).toEqual({
      error:
        'Nothing to open: the files in this request are identical to the base branch.',
    });
    // No pull request URL anywhere in the response: there is none to give.
    expect(JSON.stringify(result.body)).not.toContain('pull');
  });

  it('returns 501 when the request names no installation and none is configured', async () => {
    const openPr = vi.fn(async () => ({
      opened: true as const,
      prUrl: 'https://example.com/pull/1',
      prNumber: 1,
    }));
    const result = await openPrRouteHandler(
      validBody,
      {
        app: { appId: '123', privateKey: 'fake-key' },
        defaultInstallationId: null,
      },
      fakeOps({ openPr }),
    );

    expect(result.status).toBe(501);
    // Refused before acting, not after failing somewhere inside GitHub.
    expect(openPr).not.toHaveBeenCalled();
  });

  it.each([0, -1, 1.5])(
    'rejects installationId %s rather than passing it to Octokit',
    async (installationId) => {
      const createClient = vi.fn(async () => ({}) as never);
      const result = await openPrRouteHandler(
        { ...validBody, installationId },
        config,
        fakeOps({ createClient }),
      );

      expect(result.status).toBe(400);
      expect(createClient).not.toHaveBeenCalled();
    },
  );

  it('returns 502 when github-app throws', async () => {
    const ops = fakeOps({
      openPr: vi.fn(async () => {
        throw new Error('branch already exists');
      }),
    });
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    const result = await openPrRouteHandler(validBody, config, ops);
    consoleErrorSpy.mockRestore();

    expect(result.status).toBe(502);
  });

  // Regression test for a stale-dist class of bug: apps/api resolves
  // `@localize-infra/schemas` through that package's `"main": "./dist/index.js"`
  // (real npm/node package resolution), NOT through a relative source import.
  // packages/schemas' own vitest suite imports `./open-pr-api.js` as a
  // *relative sibling file*, which resolves to source regardless of whether
  // dist/ is built or stale — so it can never catch dist/ going stale. This
  // test calls `openPrRouteHandler` exactly as the running server does, which
  // pulls `OpenPrApiRequestSchema` in via the real package resolution path.
  // It only passes if `packages/schemas/dist/open-pr-api.js` actually
  // contains the path-validation logic; if dist/ is ever rebuilt from an
  // older commit (or not rebuilt at all), this test fails with a 200 instead
  // of the expected 400, pinning the cross-package contract.
  it('rejects a path-traversal file path via the real @localize-infra/schemas package resolution (not a relative source import)', async () => {
    const result = await openPrRouteHandler(
      {
        ...validBody,
        files: [{ path: '../../evil.yml', content: 'x' }],
      },
      config,
      fakeOps(),
    );
    expect(result.status).toBe(400);
  });

  /*
   * The route the correction actually reaches, through the same real package
   * resolution as the test above — so a stale `packages/schemas/dist` that
   * still only knows `locales/` fails here rather than in production, after a
   * correction has been paid for.
   */
  it.each([
    'public/locales/fr/translation.json',
    'src/locales/fr/translation.json',
  ])('opens a pull request that writes %s', async (path) => {
    const ops = fakeOps();
    const result = await openPrRouteHandler(
      { ...validBody, files: [{ path, content: '{}' }] },
      config,
      ops,
    );
    expect(result.status).toBe(200);
    expect(ops.openPr).toHaveBeenCalledTimes(1);
  });

  it('still refuses a path beside an allowed root', async () => {
    const result = await openPrRouteHandler(
      {
        ...validBody,
        files: [{ path: 'public/manifest.json', content: '{}' }],
      },
      config,
      fakeOps(),
    );
    expect(result.status).toBe(400);
  });

  it('does not leak the underlying error message to the caller on failure', async () => {
    const distinctiveMessage =
      'installation token abc123 lacks permission on repo xyz-internal';
    const ops = fakeOps({
      openPr: vi.fn(async () => {
        throw new Error(distinctiveMessage);
      }),
    });
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    const result = await openPrRouteHandler(validBody, config, ops);
    consoleErrorSpy.mockRestore();

    expect(result.status).toBe(502);
    const responseText = JSON.stringify(result.body);
    expect(responseText).not.toContain(distinctiveMessage);
    expect(responseText).not.toContain('abc123');
    expect(result.body).toHaveProperty('error');
    expect((result.body as { error: string }).error.length).toBeGreaterThan(0);
  });
});
