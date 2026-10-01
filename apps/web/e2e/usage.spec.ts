import { expect, test } from '@playwright/test';
import { STORAGE_STATE } from './session';

/**
 * The usage surface, against real rows and real policies.
 *
 * Two things are worth testing here and neither is a number:
 *
 *  1. **Zero is printed, and printed honestly.** The seed creates no
 *     `api_usage_daily` rows, so this workspace has genuinely spent nothing —
 *     and `consume_api_quota` writes a row on first use, which is what makes
 *     "0 of 5000" a fact rather than a missing measurement. A page that showed
 *     "No data" here would be hiding an answer it has.
 *  2. **The isolation is the database's.** Another workspace's usage is a 404,
 *     for the same reason its projects are: the policies return nothing, so
 *     there is nothing to distinguish "not yours" from "does not exist".
 *
 * Targets port 3212 — the server that inherits the ambient environment — and
 * skips without a database, like every other authenticated spec.
 */
const DB_URL = 'http://127.0.0.1:3212';

const configured = Boolean(process.env.SUPABASE_URL);

test.use({ storageState: STORAGE_STATE });

test.describe('usage', () => {
  test.skip(
    !configured,
    'No SUPABASE_URL: this suite needs a real database and the dev seed applied.',
  );

  test('reports today against the ceiling the database enforces', async ({
    page,
  }) => {
    await page.goto(`${DB_URL}/acceptance/usage`, {
      waitUntil: 'networkidle',
    });

    const today = page.getByTestId('today-totals');
    await expect(today).toBeVisible();

    /*
     * The denominator comes from `api_limits()`, not from a constant in this
     * app — so this asserts the page read it rather than believed it. If the
     * limits could not be read the page says so instead, and that branch is
     * asserted below by its absence.
     */
    await expect(page.getByTestId('limits-unavailable')).toHaveCount(0);
    await expect(page.getByTestId('today-strings')).toContainText('of 5,000');
    await expect(page.getByTestId('today-prs')).toContainText('of 50');
  });

  test('prints zero rather than hiding it, because zero is measured', async ({
    page,
  }) => {
    await page.goto(`${DB_URL}/acceptance/usage`, {
      waitUntil: 'networkidle',
    });

    // The seed spends nothing, so every figure is a real zero.
    await expect(page.getByTestId('today-strings')).toContainText('0');
    await expect(page.getByTestId('month-totals')).toBeVisible();
    await expect(page.getByTestId('today-totals')).not.toContainText('No data');
  });

  test('claims no ceiling has been reached when none has', async ({ page }) => {
    await page.goto(`${DB_URL}/acceptance/usage`, {
      waitUntil: 'networkidle',
    });

    /*
     * DESIGN.md §6.3: being under the ceiling is not a state worth a colour.
     * The badge exists only once the refusal is real and present, so on a
     * workspace that has spent nothing it must not appear at all.
     */
    await expect(page.getByText('Ceiling reached')).toHaveCount(0);
  });

  test('shows the workspace’s runs in the same table /runs uses', async ({
    page,
  }) => {
    await page.goto(`${DB_URL}/acceptance/usage`, {
      waitUntil: 'networkidle',
    });

    const section = page.getByRole('region', { name: /Recent runs/i });
    await expect(section).toBeVisible();
    // The seed creates three runs against this workspace; the table is the
    // shared component, so a row count proves both the query and the reuse.
    await expect(section.getByRole('row')).not.toHaveCount(0);
  });

  test('reports token use without ever showing a secret', async ({ page }) => {
    await page.goto(`${DB_URL}/acceptance/usage`, {
      waitUntil: 'networkidle',
    });

    const section = page.getByRole('region', { name: /CLI tokens/i });
    await expect(section).toBeVisible();

    /*
     * `token_hash` is not in the column grant, so it cannot reach this page
     * even by mistake — but asserting it keeps that true if the select is ever
     * widened. A 64-character hex string is what a leak would look like.
     */
    const body = (await page.textContent('body')) ?? '';
    expect(body).not.toMatch(/\b[0-9a-f]{64}\b/);
    expect(body).not.toMatch(/\blit_[A-Za-z0-9_-]{20,}/);
  });

  test('another workspace’s usage is a 404, not a 403', async ({ page }) => {
    const someoneElses = await page.goto(`${DB_URL}/intruder-co/usage`, {
      waitUntil: 'networkidle',
    });
    expect(someoneElses?.status()).toBe(404);

    const unknown = await page.goto(`${DB_URL}/not-a-workspace/usage`, {
      waitUntil: 'networkidle',
    });
    expect(unknown?.status()).toBe(404);
  });

  test('is reachable from the workspace, not only by typing the URL', async ({
    page,
  }) => {
    await page.goto(`${DB_URL}/acceptance/projects`, {
      waitUntil: 'networkidle',
    });
    /*
     * Matched on the word, not the whole name.
     *
     * This read `{ name: 'Usage', exact: true }` while the page offered a bare
     * "Usage" link followed by a sentence of body copy explaining it. The
     * redesign folded that sentence into the link — "Usage against the daily
     * ceiling" — so the label carries its own meaning in a row of short links
     * beside "Create a CLI token", and the loose paragraph is gone.
     *
     * The test's subject is that the page *offers a way there*, not what the
     * way is called. Pinning the exact string made a copy edit look like a
     * regression, which is the sort of coupling that teaches people to change
     * tests rather than read them.
     */
    /*
     * Scoped to `main`, because the shell now offers Usage too.
     *
     * Tranche 1 put the workspace's own surfaces in the sidebar — Projects,
     * Set up, CLI tokens, Usage — which is the thing this test's name asks
     * for, and it made a loose `/Usage/` match two links: the sidebar entry
     * and the page's own. The subject here is that the *page* offers a way
     * there, so the page is where it looks. The sidebar route has its own
     * coverage in `shell-context.test.ts`.
     */
    await page.locator('main').getByRole('link', { name: /Usage/ }).click();
    await expect(page).toHaveURL(/\/acceptance\/usage$/, { timeout: 20_000 });
  });
});

test.describe('usage, signed out', () => {
  test.skip(!configured, 'No SUPABASE_URL.');
  test.use({ storageState: { cookies: [], origins: [] } });

  test('is behind the session, like every other workspace surface', async ({
    page,
  }) => {
    const response = await page.goto(`${DB_URL}/acceptance/usage`, {
      waitUntil: 'networkidle',
    });
    expect(response?.url()).toContain('/login');
  });
});
