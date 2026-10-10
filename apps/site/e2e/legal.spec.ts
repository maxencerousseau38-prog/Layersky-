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
 * The GitHub App permissions, exactly the four the App holds.
 *
 * This page has been wrong in both directions. It first omitted
 * `checks: write`, the permission the main feature runs on. Then it listed six
 * — two annotated "to be removed" — and **kept declaring them after they were
 * removed**, so a page whose stated job is to report what GitHub reports told
 * customers the App held write access to artifact metadata that it did not.
 *
 * Three assertions, because each catches a different regression:
 *
 *   the **count**, so an addition cannot slip in unnamed;
 *   the **four scopes**, so a removal of a real one is caught too — the
 *     `checks: write` omission is the precedent;
 *   the **absence of a surplus annotation**, which is the failure that
 *     actually happened. A disclosure written as pending outlives the thing it
 *     was pending on, because nothing re-reads it. If the App ever holds more
 *     than it uses again, this test says to close the gap in the App's
 *     settings rather than to document it here.
 *
 * `scripts/github-app-permissions.mjs` is the authority and cannot run here:
 * it needs a JWT signed with the App's private key, which CI has no business
 * holding. So this pins the page against a list a human re-read from
 * `GET /app` and `GET /app/installations/<id>`, and the script is what proves
 * that list — run it when this test fails.
 */
const GITHUB_APP_PERMISSIONS = [
  'contents: write',
  'pull_requests: write',
  'checks: write',
  'metadata: read',
];

test('the security page lists exactly the permissions the App holds', async ({
  page,
}) => {
  await page.goto('/security');

  const list = page
    .locator('section[aria-labelledby="github-perms"] li')
    .filter({ has: page.locator('code') });

  await expect(
    list,
    'the permission list is not four entries long',
  ).toHaveCount(GITHUB_APP_PERMISSIONS.length);

  const rendered = (await list.allTextContents()).map((t) =>
    t.replace(/\s+/g, ' ').trim(),
  );

  for (const scope of GITHUB_APP_PERMISSIONS) {
    expect(
      rendered.some((row) => row.includes(scope)),
      `/security never names ${scope}`,
    ).toBe(true);
  }

  // The two that were removed from the App must not be described as held.
  const body = ((await page.locator('main').textContent()) ?? '').replace(
    /\s+/g,
    ' ',
  );
  for (const gone of ['artifact_metadata', 'codespaces_metadata']) {
    expect(body, `/security still declares ${gone}`).not.toContain(gone);
  }

  /*
   * And no entry confesses to being surplus. "to be removed" is what went
   * stale: the annotation survived the removal. An over-permissioned App is a
   * thing to fix in its settings, not a line to add here.
   */
  expect(body, '/security declares a permission it does not need').not.toMatch(
    /to be removed|more than the product needs|not used by any code/i,
  );
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
 * The DPA agreeing with itself, section by section.
 *
 * It carried both answers at once. "Return and deletion" said a workspace
 * deletion "is done by hand, because no surface for either exists yet";
 * "Helping you meet your own obligations" said "deleting a workspace removes
 * all of it. Nothing has to be requested for that." One document, two claims,
 * and the wrong one was the one that overstated the product.
 *
 * The test above did not catch it, which is the point of adding this one: that
 * test pinned two specific sentences from an earlier revision, so a third
 * phrasing of the same false claim sailed past. #148 corrected the clause below
 * and left this one standing — the cross-surface miss CLAUDE.md records for the
 * `export` command and for the GitHub App permissions.
 *
 * Scoped per section (`LegalSection` renders `aria-labelledby={id}`) rather
 * than over the whole page, because the page must legitimately contain both
 * "nothing has to be requested" (true of a project) and "on request" (true of a
 * workspace). Asserted over the whole body, those two cancel out and the test
 * proves nothing.
 *
 * Verified in code, not inferred: no `deleteWorkspace`, `deleteOrganization` or
 * `deleteAccount` exists anywhere in the repository. `organizations_delete_owner`
 * is an RLS policy with no application caller, and an account is additionally
 * blocked while it owns a workspace because `organizations.created_by` is
 * `on delete restrict`.
 */
test('the DPA does not promise a self-serve workspace deletion', async ({
  page,
}) => {
  await page.goto('/dpa');

  const section = async (id: string) =>
    (
      (await page.locator(`section[aria-labelledby="${id}"]`).textContent()) ??
      ''
    ).replace(/\s+/g, ' ');

  const assistance = await section('assistance');
  const deletion = await section('deletion');

  expect(assistance, 'the obligations section is missing').not.toBe('');
  expect(deletion, 'the deletion section is missing').not.toBe('');

  // The exact claim that was there.
  expect(
    assistance,
    'the DPA still says a workspace deletion removes everything with no request',
  ).not.toMatch(/deleting a workspace removes all of it/i);

  /*
   * And the shape of it, reworded. `[^.]*` cannot cross a sentence boundary, so
   * this does not fire on the corrected text — where "Nothing has to be
   * requested for that." ends the project sentence and the workspace sentence
   * begins after it.
   */
  expect(
    assistance,
    'the obligations section puts a workspace deletion in the no-request category',
  ).not.toMatch(
    /workspace[^.]*nothing has to be requested|nothing has to be requested[^.]*workspace/i,
  );

  // The accurate routing is present, so deleting the sentence fails this too.
  expect(
    assistance,
    'the obligations section never says a workspace deletion must be asked for',
  ).toMatch(/workspace.{0,80}(asked for|on request|by request)/i);
  expect(
    assistance,
    'the obligations section never says there is no self-serve surface',
  ).toMatch(/no self-serve surface/i);

  // Project deletion remains the one described as immediate.
  expect(
    assistance,
    'the obligations section lost the project-deletion capability',
  ).toMatch(/deleting a project/i);

  // Both sections have to agree, which is the property that failed.
  expect(
    deletion,
    'the deletion section no longer describes the request route',
  ).toMatch(/done by hand|on request/i);
  expect(
    deletion,
    'the deletion section no longer says the surface is missing',
  ).toMatch(/no surface for either exists/i);

  /*
   * No timescale or named owner is asserted, because none is claimed. The
   * paragraph that follows already states what is promised for anything the
   * product cannot do, and pinning a deadline here would turn a test into the
   * source of a contractual commitment nobody made.
   */
  expect(
    assistance,
    'the obligations section invents a deletion deadline',
  ).not.toMatch(/within \d+ (business )?days|\d+-day|immediately on request/i);
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
