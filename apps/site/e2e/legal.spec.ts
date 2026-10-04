import { expect, test } from '@playwright/test';
import { SUPPORT_EMAIL } from '../src/lib/constants';

/**
 * The private channel, in whichever state it is actually in.
 *
 * `SUPPORT_EMAIL` switches four pages at once, and this repository has
 * already shipped a text branch nobody had ever seen: the
 * `CLI_PERSONAL_TOKENS_LIVE` copy was wrong for weeks in the branch that was
 * not live, because a branch that never renders never gets read. So both
 * branches are asserted here, and whichever one is not live today is still
 * the one a future edit will turn on.
 *
 * The shape is the one `interaction.spec.ts` already uses for that flag:
 * branch on the constant, assert the copy that belongs to it, and assert the
 * absence of the copy that does not.
 */

/** Every page that has to agree about whether a private channel exists. */
const PAGES = ['/contact', '/privacy', '/dpa', '/terms'];

for (const path of PAGES) {
  test(`${path} describes the contact channel that actually exists`, async ({
    page,
  }) => {
    await page.goto(path);
    const mailto = page.locator('a[href^="mailto:"]');

    if (SUPPORT_EMAIL === null) {
      // No address anywhere. A mailto: link to an address that receives no
      // mail is the failure this constant exists to prevent, and it would be
      // invisible in review — the link looks right.
      await expect(mailto).toHaveCount(0);
    } else {
      await expect(mailto.first()).toBeVisible();
      for (const href of await mailto.evaluateAll((as) =>
        as.map((a) => (a as HTMLAnchorElement).getAttribute('href') ?? ''),
      )) {
        expect(href.startsWith(`mailto:${SUPPORT_EMAIL}`)).toBe(true);
      }
    }
  });
}

/*
 * The gap is disclosed where somebody weighing the product will meet it, not
 * only where it is convenient to mention. While there is no private channel,
 * /contact and /privacy must both say so; once there is one, neither may keep
 * claiming there is not.
 */
test('the absence of a private channel is disclosed, or gone', async ({
  page,
}) => {
  for (const path of ['/contact', '/privacy']) {
    await page.goto(path);
    const body = ((await page.locator('main').textContent()) ?? '').replace(
      /\s+/g,
      ' ',
    );
    if (SUPPORT_EMAIL === null) {
      expect(body, `${path} hides the missing private channel`).toMatch(
        /no private channel|In private, nowhere yet|no support address is published/i,
      );
    } else {
      expect(
        body,
        `${path} still claims there is no private channel`,
      ).not.toMatch(
        /there is currently no private channel|In private, nowhere yet/i,
      );
    }
  }
});

/*
 * The DPA has to describe the processing that happens, so the two facts most
 * likely to be quietly dropped from a template are pinned: the transfer out
 * of the EU, and the sub-processors. A DPA that omits either is the kind a
 * reviewer rejects on sight.
 */
test('the DPA names the transfer and every sub-processor', async ({ page }) => {
  await page.goto('/dpa');
  const body = ((await page.locator('main').textContent()) ?? '').replace(
    /\s+/g,
    ' ',
  );

  for (const name of ['Supabase', 'Vercel', 'Anthropic', 'OpenAI', 'GitHub']) {
    expect(body, `the DPA never names ${name}`).toContain(name);
  }
  expect(body).toContain('United States');

  // The honest half. A DPA claiming standard contractual clauses nobody
  // executed would be the first false statement on this site, and it is
  // exactly the sentence a template would supply.
  expect(body).toMatch(/no standard contractual clauses have been separately/i);
});

/*
 * The DPA is reachable. A legal page nobody can navigate to is a page that
 * exists for the author rather than the reader, and this one is linked from
 * three others — the footer carries it, which is where a reviewer looks
 * first.
 */
test('the DPA is linked from the footer', async ({ page }) => {
  await page.goto('/');
  await expect(
    page
      .getByRole('contentinfo')
      .getByRole('link', { name: /data processing/i }),
  ).toHaveAttribute('href', '/dpa');
});
