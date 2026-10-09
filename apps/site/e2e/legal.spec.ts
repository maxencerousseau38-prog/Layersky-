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

/*
 * Deletion, promised only where a control exists.
 *
 * Both pages told the reader to delete their workspace. Only project deletion
 * ships — `deleteProject`, owner-or-admin, on the project's own page — and an
 * account cannot be deleted at all while it owns a workspace, because
 * `organizations.created_by` is `on delete restrict`. The cascade was never
 * the wrong part: every table carrying an `organization_id` declares
 * `on delete cascade`. What was wrong was who can trigger it.
 *
 * This is the one assertion on these pages that a *feature* could falsify
 * rather than a copy edit: build self-serve workspace deletion and this test
 * should be changed in the same pull request, deliberately. Until then an
 * erasure right described as self-serve is a promise the product cannot keep.
 */
test('no legal page promises self-serve workspace or account deletion', async ({
  page,
}) => {
  for (const path of ['/privacy', '/dpa']) {
    await page.goto(path);
    const body = ((await page.locator('main').textContent()) ?? '').replace(
      /\s+/g,
      ' ',
    );

    // The instruction that had nothing behind it, in either page's wording.
    expect(
      body,
      `${path} tells the reader to delete their own workspace`,
    ).not.toMatch(/delete the project or the workspace/i);
    /*
     * Unanchored, deliberately. Written as `/^Delete the workspace…/` first,
     * which could never match: the normalised body starts with the page
     * header, so the assertion passed without testing anything — the vacuous
     * shape this repository keeps paying for. The replacement text reads "the
     * workspace is deleted", which this pattern does not match.
     */
    expect(body, `${path} instructs a workspace deletion`).not.toMatch(
      /Delete the workspace and its data goes with it/i,
    );

    // And the accurate version is present rather than merely the wrong one
    // removed — otherwise deleting the sentence outright would pass this.
    expect(
      body,
      `${path} never says a workspace deletion is a request`,
    ).toMatch(/by request|on request/i);
  }

  await page.goto('/privacy');
  const privacy = ((await page.locator('main').textContent()) ?? '').replace(
    /\s+/g,
    ' ',
  );
  expect(privacy).toMatch(/deleting a project is self-serve/i);
});

/*
 * Every provider the code can call, named where a reader looks for it.
 *
 * `apps/api/src/router/index.ts` declares
 * `PROVIDER_NAMES = ['anthropic', 'openai']` and spreads the target locales
 * across whichever the process holds a key for, so an OpenAI key on the API
 * instance adds a second recipient of customer source code. /privacy named
 * only Anthropic while /security#subprocessors carried both — two trust pages
 * disagreeing about who receives code.
 *
 * The condition is asserted too, not just the name: "OpenAI" without "when
 * configured" would read as an unconditional transfer, which is the opposite
 * error.
 */
test('the privacy page names every model provider the code can call', async ({
  page,
}) => {
  await page.goto('/privacy');
  const body = ((await page.locator('main').textContent()) ?? '').replace(
    /\s+/g,
    ' ',
  );

  for (const name of ['Anthropic', 'OpenAI']) {
    expect(body, `/privacy never names ${name}`).toContain(name);
  }
  expect(body, '/privacy states the OpenAI transfer unconditionally').toMatch(
    /when the API instance is configured with an OpenAI key/i,
  );

  /*
   * No legal validation is claimed for the transfer. The DPA's own disclosure
   * — no standard contractual clauses, no transfer impact assessment — is
   * pinned in the test above; this is the other half, on the page a reader
   * reaches first.
   */
  expect(body, '/privacy claims the transfer is validated').not.toMatch(
    /standard contractual clauses (are|have been) (in place|executed)|lawful basis for the transfer is established|transfer is (legally )?validated/i,
  );
});

/*
 * The repository link is the current repository.
 *
 * `GITHUB_REPO_URL` pointed at `…/localize-infra`, the name before the rename.
 * GitHub redirects it, so nothing failed — and the redirect lasts only while
 * nobody else claims that name. This constant is also the public contact
 * channel (`CONTACT_URL` is it plus `/issues`), so a lapsed redirect would
 * take the one channel a visitor can use without an email address.
 *
 * Asserted on the rendered href rather than on the constant, which would be a
 * test of an assignment.
 */
test('every repository link points at the current repository', async ({
  page,
}) => {
  for (const path of ['/', '/security', '/contact']) {
    await page.goto(path);
    const hrefs = await page
      .locator('a[href*="github.com/maxencerousseau38-prog"]')
      .evaluateAll((links) => links.map((l) => l.getAttribute('href') ?? ''));

    /*
     * Non-empty, asserted. A loop over nothing passes, and the header and
     * footer carry this link on every page — so zero here means the layout
     * changed, not that the links are correct.
     */
    expect(
      hrefs.length,
      `${path} renders no repository link to check`,
    ).toBeGreaterThan(0);

    for (const href of hrefs) {
      // The fixture repositories are separate repositories and keep their
      // names; only the product repository was renamed.
      if (href.includes('-fixture-')) continue;
      expect(href, `${path} links the repository's old name`).not.toMatch(
        /maxencerousseau38-prog\/localize-infra(\/|$)/,
      );
    }
  }
});
