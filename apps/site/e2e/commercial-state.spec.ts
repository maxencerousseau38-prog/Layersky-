import { expect, test } from '@playwright/test';

/**
 * What the site says about its own commercial maturity.
 *
 * These are the claims that go stale by being *overtaken* rather than by being
 * wrong when written, which is the failure mode this repository keeps paying
 * for: a sentence that was true in August describes a product that no longer
 * exists, and nothing re-reads it. `09-unit-economics.md` had been stale for
 * six weeks for exactly this reason.
 *
 * Every assertion here comes in a pair — the old phrasing must be gone **and**
 * the accurate one present. Asserting only the absence would pass if somebody
 * deleted the sentence outright, which would lose the disclosure rather than
 * fix it.
 */

const normalised = async (locator: {
  textContent: () => Promise<string | null>;
}) => ((await locator.textContent()) ?? '').replace(/\s+/g, ' ');

/*
 * The cost model exists, and three narrower things do not.
 *
 * `packages/pricing` generates `src/report/cost-model.json` and a test asserts
 * the committed artefact matches its generator; `docs/product/09-unit-economics.md`
 * carries the narrative. A production correction was measured on 2026-10-09 and
 * recorded as `productionObservation`.
 *
 * So "we have not finished modelling what the service costs" understated the
 * work and overstated the uncertainty at the same time. What is genuinely
 * missing is the invoice reconciliation, the commercial numbers, and anyone
 * who has agreed to pay — and a reader deciding whether to trust this product
 * is owed the precise version.
 */
test('no page claims the cost of running the service is unmodelled', async ({
  page,
}) => {
  for (const path of ['/pricing', '/roadmap']) {
    await page.goto(path);
    const body = await normalised(page.locator('main'));

    expect(
      body,
      `${path} still says the cost model is unfinished or absent`,
    ).not.toMatch(
      /have not finished modell|not modelled yet|pricing is not modelled|that model does not exist/i,
    );

    // The accurate half, so removing the sentence does not pass this test.
    expect(body, `${path} never states that costs are modelled`).toMatch(
      /is (now )?modelled/i,
    );
  }
});

/*
 * Modelled is not the same as reconciled, and /pricing has to say which.
 *
 * `cost-model.json` carries `reconciledAgainstInvoice: false`. The measured
 * figures are token consumption priced at the provider's published rate — a
 * derived number, not an amount anybody has been billed. Presenting it as a
 * settled cost would be the internal-assumption-as-confirmed-result error the
 * whole page argues against.
 */
test('/pricing separates a modelled cost from a reconciled one', async ({
  page,
}) => {
  await page.goto('/pricing');
  const body = await normalised(page.locator('main'));

  expect(body, '/pricing never says the cost is unreconciled').toMatch(
    /not been reconciled|reconciled against/i,
  );
  expect(body, '/pricing never mentions the supplier invoice').toMatch(
    /invoice/i,
  );

  // Nor may it claim the opposite.
  expect(body, '/pricing claims the cost is confirmed by a bill').not.toMatch(
    /reconciled against (our|the) (supplier )?invoices?\b(?! )/i,
  );

  // Willingness to pay is open, not validated.
  expect(body, '/pricing never says nobody has agreed to pay yet').toMatch(
    /nobody outside this project has agreed to pay|no customer has agreed to pay/i,
  );
  expect(body, '/pricing claims validated demand').not.toMatch(
    /customers have (confirmed|validated)|validated (demand|willingness)|proven willingness to pay/i,
  );
});

/*
 * Two principles that have to coexist, because both are true.
 *
 * Invariant 3 forbids metering: nothing is billed by word, character, key or
 * seat, and the product deliberately computes no such counter. But the hosted
 * API does enforce a daily ceiling (`api_limits()`), and a ceiling a user can
 * hit is a ceiling the page has to name. /pricing said "no string cap" until
 * the API grew one.
 *
 * The pledge and the ceiling are asserted together, because dropping either
 * one produces a page that is honest about half of it.
 */
test('/pricing keeps the never-metered pledge and still names the ceiling', async ({
  page,
}) => {
  await page.goto('/pricing');
  const body = await normalised(page.locator('main'));

  for (const metered of [
    'Words translated',
    'Characters processed',
    'Keys stored',
    'Seats or reviewers',
  ]) {
    expect(body, `/pricing dropped "${metered}" from the pledge`).toContain(
      metered,
    );
  }

  // The ceiling, with its numbers, read from `HOSTED_API_LIMITS`.
  expect(body, '/pricing hides the daily ceiling').toMatch(/5,000 strings/i);
  expect(body, '/pricing hides the pull request ceiling').toMatch(
    /50 pull requests/i,
  );

  // And it must say what the ceiling is for, or naming it reads as a quota
  // sold back to the reader — which is the thing invariant 3 forbids.
  expect(body, '/pricing never says the ceiling is not a charge').toMatch(
    /rather than to charge you|not a meter/i,
  );

  // The reverse claim must be gone: it said "no string cap" before the API
  // grew one, and that exact phrasing is what went stale.
  expect(body, '/pricing still claims there is no string cap').not.toMatch(
    /no string cap/i,
  );
});

/*
 * The pricing axes are criteria, not a published offer.
 *
 * `09-unit-economics.md` records Free/Starter/Team/Scale and $19/$99/$399 as
 * *recommendations* derived from cost, and says in terms that they "remain
 * hypotheses". None of that may appear here as a plan a reader could buy.
 */
test('/pricing publishes no price and no plan names', async ({ page }) => {
  await page.goto('/pricing');
  const body = await normalised(page.locator('main'));

  expect(body, '/pricing publishes a currency figure').not.toMatch(/\$\s?\d/);
  for (const plan of ['Starter', 'Team plan', 'Scale plan']) {
    expect(body, `/pricing names the internal plan "${plan}"`).not.toContain(
      plan,
    );
  }

  // It does still say prices are unset, which is the disclosure that makes the
  // absence of numbers deliberate rather than an oversight.
  expect(body, '/pricing never says prices are unset').toMatch(
    /not priced yet|not decided/i,
  );
});

/*
 * The footer is on every page, and it told the reader to delete their account.
 *
 * Project deletion ships (`deleteProject`, owner-or-admin, confirmed by typing
 * the slug). Deleting a workspace or an account has **no** surface: no
 * `deleteWorkspace`, `deleteOrganization` or `deleteAccount` exists anywhere in
 * the repository, and `/privacy` plus the app's danger zone both describe it as
 * done on request. An account is additionally blocked while it owns a
 * workspace, because `organizations.created_by` is `on delete restrict`.
 *
 * The sentence's point is portability — your files survive — so it does not
 * need to imply a button, and it must not.
 */
test('no marketing surface instructs a self-serve account deletion', async ({
  page,
}) => {
  for (const path of ['/', '/pricing', '/security']) {
    await page.goto(path);

    /*
     * The whole page, not just the footer. This was scoped to `footer` first
     * and passed while the landing page's own "Cancel and keep everything"
     * card carried the identical sentence — the same cross-surface miss, this
     * time committed by the test that was meant to catch it.
     */
    const body = await normalised(page.locator('body'));

    expect(
      body,
      `${path} tells the reader to delete their account`,
    ).not.toMatch(/delete (the|your) (account|workspace)/i);

    // The portability claim it exists to make is still there, so this test
    // fails if the sentence was removed rather than corrected.
    expect(body, `${path} lost the portability claim`).toMatch(/git pull/i);
  }
});
