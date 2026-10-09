import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

/**
 * Next loads apps/web/.env.local for the server it runs; the test process does
 * not see it. auth.spec.ts decides whether to run by looking for SUPABASE_URL,
 * so without this it skipped itself on the very machine that can run it.
 *
 * Deliberately does not overwrite anything already set: CI passes real values
 * through the environment, and a stray checked-out file must not win over them.
 */
function loadLocalEnv(): void {
  const path = join(__dirname, '.env.local');
  if (!existsSync(path)) return;

  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (!key || process.env[key]) continue;
    process.env[key] = (rawValue ?? '').replace(/^["']|["']$/g, '');
  }
}

loadLocalEnv();

/**
 * Observed once, not reproduced: on 2026-08-08 a single `turbo run test:e2e`
 * reported this suite as failed. Turbo surfaced only "Lifecycle script failed",
 * so the failing test was never captured.
 *
 * It has not recurred in seven subsequent runs — three with `.turbo` and both
 * `.next` directories deleted, the rest warm, standalone and through turbo.
 *
 * Deliberately NOT addressed by adding `retries`. A retry would turn this into
 * a green run that hides the very signal worth having, and the suite's value is
 * that it catches things nothing else does. If it recurs, run the suite
 * directly rather than through turbo so the reporter names the test, and
 * capture that name before rerunning — it is the only missing fact.
 */

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  reporter: [['list']],
  use: { baseURL: 'http://127.0.0.1:3211', trace: 'off' },
  projects: [
    /*
     * Signs in once and saves the session for the suites that need one.
     *
     * A dependency rather than a `globalSetup` so it appears in the reporter
     * with a name: when the seeded account is missing, "authenticate as the
     * seeded user" failing says what is wrong, where a global setup failure
     * says only that the run did not start.
     */
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['setup'],
    },
  ],
  webServer: [
    {
      command: 'npx next start -p 3211',
      url: 'http://127.0.0.1:3211',
      // Never reuse in CI. A stale server left on this port would answer every
      // request and the suite would pass against code that is not the code under
      // test — a failure this repo has already paid for once.
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      /*
       * Started with no database on purpose, and stated rather than inherited.
       *
       * This suite tests the application shell: navigation, the command palette,
       * tables, sample-data honesty, axe, responsive behaviour. None of it is
       * about authentication, and all of it lives behind a login the moment
       * SUPABASE_URL is set — 52 of these tests began redirecting to /login the
       * hour auth landed.
       *
       * Setting the variables to empty here overrides apps/web/.env.local, so a
       * developer with a working local database and CI without one run the same
       * suite against the same configuration. The alternative — inheriting
       * whatever the machine happens to have — is how a suite passes for one
       * person and fails for another.
       *
       * Authentication itself is covered by e2e/auth.spec.ts, which starts its
       * own server with a real database and skips when there is none.
       */
      /*
       * All three blanked, not two.
       *
       * `SUPABASE_SERVICE_ROLE_KEY` was inherited while the other two were
       * overridden, so this server's configuration was only mostly stated —
       * and the one variable escaping the override was the one that bypasses
       * RLS. Harmless as it stood: with no `SUPABASE_URL` the application is
       * unconfigured, `/closer/*` answers 404 and no admin client is ever
       * built. But "stated rather than inherited" is the whole argument for
       * this block, and a server in this suite quietly holding admin
       * credentials is a bad thing to leave for the next test to find.
       *
       * Nothing here reads it. The specs on this port are a11y, interaction
       * and perf; every database-backed spec targets 3212, and `auth.setup.ts`
       * names that port outright. The activation test's own skip reads the
       * variable from the Playwright process rather than from this server, so
       * it is unaffected.
       */
      env: {
        SUPABASE_URL: '',
        SUPABASE_PUBLISHABLE_KEY: '',
        SUPABASE_SERVICE_ROLE_KEY: '',
      },
    },
    /*
     * The same build, with a real database, on its own port.
     *
     * auth.spec.ts targets this one. It is a second server rather than a flag
     * on the first because the two suites need opposite configurations: the
     * shell suite must not be behind a login, and the auth suite is entirely
     * about being behind one.
     *
     * Inherits the ambient environment, so it is configured on a machine with
     * apps/web/.env.local and unconfigured in CI. The spec skips itself when
     * there is no database rather than failing, and says so in the skip
     * reason — a red suite for a missing secret teaches nothing.
     */
    {
      command: 'npx next start -p 3212',
      url: 'http://127.0.0.1:3212',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});
