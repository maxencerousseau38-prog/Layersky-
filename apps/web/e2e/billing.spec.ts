import { expect, test } from '@playwright/test';
import { STORAGE_STATE } from './session';

/**
 * The billing surface, which bills nothing — and has to say so accurately.
 *
 * This page's whole job is to agree with `/pricing` on the marketing site. A
 * workspace surface that implied a card on file, a trial clock or a usage meter
 * would make that page a lie, and the argument that page makes is precisely
 * that this product does not do that.
 *
 * It had drifted from `/pricing` in three ways at once, all of them the same
 * shape: a claim corrected on one surface and left standing on another.
 * CLAUDE.md records that pattern twice already — the `export` command on
 * `/docs` after `/[org]/start` had fixed it, and `/security` declaring two
 * GitHub App permissions for weeks after they were removed. The lesson it draws
 * is the one these tests encode: **a tested fix on one surface says nothing
 * about another surface that repeats the same claim.**
 *
 * Targets port 3212 — the server that inherits the ambient environment — and
 * skips without a database, like every other authenticated spec.
 */
const DB_URL = 'http://127.0.0.1:3212';

const configured = Boolean(process.env.SUPABASE_URL);

test.use({ storageState: STORAGE_STATE });

test.describe('billing', () => {
  test.skip(
    !configured,
    'No SUPABASE_URL: this suite needs a real database and the dev seed applied.',
  );

  /*
   * "No string cap" was fixed on /pricing and left here.
   *
   * The hosted API enforces a daily ceiling — `api_limits()` returns
   * `strings_per_day` and `prs_per_day`, and `consume_api_quota` refuses past
   * them with a 429. So this page stated the opposite of what the API does.
   *
   * The numbers are deliberately *not* asserted here. They live in
   * `api_limits()` and `/[org]/usage` reads them from there; duplicating them
   * into a third place is the drift this test exists to catch. What is asserted
   * is that the ceiling is acknowledged and that the false absolute is gone.
   */
  test('does not claim an uncapped allowance the API would refuse', async ({
    page,
  }) => {
    await page.goto(`${DB_URL}/acceptance/billing`, {
      waitUntil: 'networkidle',
    });

    const body = ((await page.locator('main').textContent()) ?? '').replace(
      /\s+/g,
      ' ',
    );

    expect(body, 'billing still claims there is no string cap').not.toMatch(
      /no language, string or seat cap|no string cap/i,
    );

    // The ceiling is acknowledged rather than the sentence simply deleted.
    expect(body, 'billing never mentions the daily ceiling').toMatch(
      /daily ceiling/i,
    );

    // And it says what the ceiling is for. Naming a limit without saying it is
    // not a charge reads as a quota sold back to the reader, which is the
    // thing invariant 3 forbids.
    expect(body, 'billing never says the ceiling is not a charge').toMatch(
      /rather than to charge you/i,
    );

    // The pledge itself survives: no metering, in the same words /pricing uses.
    expect(body, 'billing dropped the never-metered pledge').toMatch(
      /never metered by words, characters, keys or seats/i,
    );
  });

  /*
   * The cost model exists, so "pricing is not modelled yet" is false.
   *
   * `packages/pricing` generates `cost-model.json`, a test asserts the
   * committed artefact matches its generator, and a production correction was
   * measured on 2026-10-09. What is genuinely missing is narrower and has to be
   * stated as such: no reconciliation against a supplier invoice, no decided
   * commercial figures, and no customer who has agreed to pay.
   */
  test('states the cost model exists and what it does not settle', async ({
    page,
  }) => {
    await page.goto(`${DB_URL}/acceptance/billing`, {
      waitUntil: 'networkidle',
    });

    const body = ((await page.locator('main').textContent()) ?? '').replace(
      /\s+/g,
      ' ',
    );

    expect(body, 'billing still says pricing is not modelled').not.toMatch(
      /(pricing|cost) is not modelled|not modelled yet/i,
    );

    expect(body, 'billing never says the cost is modelled').toMatch(
      /is modelled/i,
    );
    expect(
      body,
      'billing never discloses the missing invoice reconciliation',
    ).toMatch(/not reconciled against|reconciled against a supplier invoice/i);
    expect(body, 'billing never says nobody has agreed to pay').toMatch(
      /no customer has agreed to pay/i,
    );

    // The opposite claim must not appear: a modelled cost is not a confirmed
    // commercial result.
    expect(body, 'billing presents the model as validated demand').not.toMatch(
      /validated (demand|willingness)|customers have confirmed/i,
    );

    // Still no number, on the surface where inventing one would be worst.
    expect(body, 'billing publishes a price').not.toMatch(/\$\s?\d/);
  });

  /*
   * "In development" disagreed with /pricing's "Not started".
   *
   * There is no Stripe anywhere in the repository — checked by grep, and the
   * only occurrences are comments recording its absence plus an
   * `stripe_subscription_id` column with no writer. "In development" tells a
   * reader work is under way, which is the phrase `build-status.tsx` already
   * removed from three rows for having no commits behind it.
   */
  test('agrees with /pricing that billing is not started', async ({ page }) => {
    await page.goto(`${DB_URL}/acceptance/billing`, {
      waitUntil: 'networkidle',
    });

    const paid = page.locator('section[aria-labelledby="paid"]');
    await expect(paid).toBeVisible();

    await expect(
      paid,
      'billing claims work is under way on payments',
    ).not.toContainText('In development');
    await expect(
      paid,
      'billing lost the maturity badge entirely',
    ).toContainText('Not started');
  });
});
