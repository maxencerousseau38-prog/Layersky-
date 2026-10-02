import { describe, expect, it } from 'vitest';
import { resolveRoute, workspaceNav, workspaceRoutes } from './nav';
import { orgSlugFromPath } from './shell-context';

describe('orgSlugFromPath', () => {
  it('reads the workspace a path is inside', () => {
    expect(orgSlugFromPath('/layersky/projects')).toBe('layersky');
    expect(orgSlugFromPath('/layersky/projects/my-app')).toBe('layersky');
    expect(orgSlugFromPath('/layersky')).toBe('layersky');
  });

  /*
   * `/{org}` and `/runs` are the same shape. Without the reserved list a
   * reader on `/runs/abc` would be told their workspace is called "runs" and
   * the navigation would offer `/runs/projects` — four dead links, drawn
   * confidently.
   */
  it.each([
    '/runs',
    '/runs/abc',
    '/review',
    '/locales',
    '/ambiguity',
    '/settings',
    '/design',
    '/login',
    '/onboarding',
    '/closer/companies',
    '/api/version',
    '/github/callback',
    '/auth/callback',
  ])('does not read %s as a workspace', (path) => {
    expect(orgSlugFromPath(path)).toBeNull();
  });

  it('answers null for the root and for nothing', () => {
    expect(orgSlugFromPath('/')).toBeNull();
    expect(orgSlugFromPath('')).toBeNull();
    expect(orgSlugFromPath(null)).toBeNull();
  });

  /*
   * Every top-level route in the application must be reserved. A route added
   * without a thought here produces a navigation group of dead links, and the
   * symptom is four plausible entries rather than an error — which is why this
   * is a test and not a comment.
   */
  it('reserves every non-workspace top-level segment the app serves', () => {
    const topLevel = [
      '/ambiguity',
      '/api/github/webhook',
      '/auth/callback',
      '/closer',
      '/design',
      '/github/callback',
      '/locales',
      '/login',
      '/onboarding',
      '/review',
      '/runs',
      '/settings',
    ];
    for (const path of topLevel) {
      expect(orgSlugFromPath(path), path).toBeNull();
    }
  });
});

describe('workspaceNav', () => {
  it('scopes every entry to the workspace it was given', () => {
    const routes = workspaceNav('layersky');
    expect(routes).not.toHaveLength(0);
    for (const route of routes) {
      expect(route.href.startsWith('/layersky/')).toBe(true);
    }
  });

  /*
   * Health comes first, and the order is the assertion.
   *
   * This read "the four surfaces the shell was missing" and listed them from
   * Projects. The guardrail — pull request in, check out, corrective pull
   * request when the fix is safe — had no entry at all, so the product that
   * runs continuously was the one the navigation did not name. Ranking by
   * frequency of use (DESIGN.md §9), a check that fires on every pull request
   * outranks a setup flow somebody walks once.
   */
  it('names the workspace surfaces, health first', () => {
    expect(workspaceNav('acme').map((r) => r.href)).toEqual([
      '/acme/health',
      '/acme/projects',
      '/acme/start',
      '/acme/tokens',
      '/acme/usage',
    ]);
  });

  /*
   * The detail route resolves to its parent, which is what gives it a way
   * back. A nested route absent from the nav list used to leave the breadcrumb
   * reading just the product name — the defect `resolveRoute` was written for,
   * and a brand-new nested route is exactly where it would recur.
   */
  it('resolves a health check detail page back to Health', () => {
    const { route, detail } = resolveRoute('/acme/health/abc-123', 'acme');
    expect(route?.href).toBe('/acme/health');
    expect(detail).toBe('abc-123');
  });

  /*
   * Billing stays out. The page renders "Paid plans are not priced yet" and
   * nothing else; a permanent navigation entry for it advertises a feature
   * that does not exist. It lives in the account menu instead.
   */
  it('does not put billing in the navigation', () => {
    expect(workspaceNav('acme').some((r) => r.href.includes('billing'))).toBe(
      false,
    );
  });

  it('marks nothing as unbuilt, because every one reads the database', () => {
    for (const route of workspaceNav('acme')) {
      expect(route.built, route.href).toBe(true);
    }
  });
});

/**
 * The breadcrumb, which named half the application and not the other half.
 *
 * Measured across the twelve routes in the shell audit: `/runs`, `/review`,
 * `/ambiguity`, `/locales` and `/settings` read "Layersky / <name>", and
 * `/{org}/projects`, `/{org}/projects/{project}`, `/{org}/start`,
 * `/{org}/tokens`, `/{org}/usage` and `/{org}/billing` read "Layersky" and
 * stopped — because `resolveRoute` only ever searched `ALL_ROUTES`, which does
 * not contain a route whose href depends on a slug.
 */
describe('resolveRoute', () => {
  it('still names the flat routes without any workspace', () => {
    expect(resolveRoute('/runs').route?.label).toBe('Runs');
    expect(resolveRoute('/settings').route?.label).toBe('Settings');
  });

  it('names a workspace route once it is given the workspace', () => {
    expect(resolveRoute('/acme/projects', 'acme').route?.label).toBe(
      'Projects',
    );
    expect(resolveRoute('/acme/start', 'acme').route?.label).toBe('Set up');
    expect(resolveRoute('/acme/tokens', 'acme').route?.label).toBe(
      'CLI tokens',
    );
    expect(resolveRoute('/acme/usage', 'acme').route?.label).toBe('Usage');
  });

  /*
   * Billing is out of the sidebar and still has to say where you are — it is
   * reachable from the account menu, so a reader gets there and the bar has to
   * answer them.
   */
  it('names billing, which the navigation deliberately omits', () => {
    expect(resolveRoute('/acme/billing', 'acme').route?.label).toBe('Billing');
    expect(workspaceNav('acme').some((r) => r.href.includes('billing'))).toBe(
      false,
    );
    expect(
      workspaceRoutes('acme').some((r) => r.href.includes('billing')),
    ).toBe(true);
  });

  it('keeps a project detail page a way back, not a label', () => {
    const { route, detail } = resolveRoute('/acme/projects/my-app', 'acme');
    expect(route?.href).toBe('/acme/projects');
    expect(detail).toBe('my-app');
  });

  /*
   * The one that is not cosmetic.
   *
   * `shell-context.ts` had to fix this exact bug in the sidebar: a slug taken
   * from the URL drew a workspace's navigation around the 404 page of a
   * workspace the reader is not in. The breadcrumb labelling a route inside
   * someone else's workspace would be the same assertion, more quietly. The
   * caller passes the slug resolved against `listOrganizations` under RLS, so
   * a path into any other workspace must resolve to nothing.
   */
  it('never names a route inside a workspace that is not the reader’s', () => {
    for (const path of [
      '/someone-else/projects',
      '/someone-else/usage',
      '/someone-else/projects/their-app',
      '/someone-else/billing',
    ]) {
      expect(resolveRoute(path, 'acme').route, path).toBeUndefined();
      expect(resolveRoute(path, null).route, path).toBeUndefined();
    }
  });

  /*
   * `/design` stays resolvable while being unlisted. Hiding a destination and
   * refusing to name it are different decisions; only the first was taken.
   */
  it('still names the internal gallery for anyone who opens it directly', () => {
    expect(resolveRoute('/design').route?.label).toBe('Design system');
  });
});
