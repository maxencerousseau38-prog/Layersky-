import { type Page, expect, test } from '@playwright/test';

/**
 * The journey this product is sold on, walked by somebody who has nothing.
 *
 * Every other authenticated spec signs in as the seeded `acceptance` account,
 * which already has a workspace and two projects. That is the right fixture for
 * testing surfaces and the wrong one for testing *arrival*: the seeded account
 * can never be on the first step, so nothing exercised the screens a real new
 * user meets first. This file creates its own account for exactly that reason.
 *
 * ## Why it creates, and why serially
 *
 * `workspace.spec.ts` warns that a suite creating a workspace every run "fails
 * on the unique slug the second time" — so both the email and the slug here
 * carry a random suffix. A shared fixture could not work anyway: the subject is
 * a workspace with no history, and the first run would destroy it.
 *
 * `describe.serial` with one page for the whole block is not a convenience. Six
 * independent tests would mean six sign-ups per run, and these accounts are
 * real rows in whatever database the suite is pointed at — ephemeral in CI,
 * long-lived on a developer machine pointed at the dev project. One account per
 * journey also happens to be the honest shape of the thing being tested: a
 * person arrives once and walks forward.
 *
 * Nothing else reads these rows, so no parallel test can race them.
 *
 * Local sign-up needs no email confirmation — `supabase/config.toml` sets
 * `enable_confirmations = false` — so the account is usable immediately.
 */
const AUTH_URL = 'http://127.0.0.1:3212';
const PASSWORD = 'onboarding-e2e-pw-24chars';

const configured = Boolean(process.env.SUPABASE_URL);

/**
 * Unique per run: two runs against one database must not collide.
 *
 * **`example.com`, not `localize-infra.dev`.** The seeded account uses the
 * latter, which works only because the seed inserts it in SQL and skips the
 * auth API entirely. Going through sign-up the way a real visitor does, a
 * hosted Supabase project answers `Email address "…@localize-infra.dev" is
 * invalid` — the domain has never been registered (CLAUDE.md records the same
 * fact about the site's canonical URL), so it has no MX record. `example.com`
 * is reserved by RFC 2606 for exactly this and does have one, so the journey
 * runs against CI's local stack and a developer's hosted project alike.
 */
function unique(): { email: string; workspace: string; slug: string } {
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  return {
    email: `onboarding-${id}@example.com`,
    // `toSlug` lowercases and hyphenates, so this name's slug is predictable
    // without duplicating that function here.
    workspace: `Onboard ${id}`,
    slug: `onboard-${id}`,
  };
}

/**
 * Creates the account and ends up signed in, whichever way the project is set
 * up.
 *
 * **Two outcomes are legitimate, and which one occurs is a property of the
 * database rather than of this application.** `signUp` always answers with
 * "check your email" — identical whether or not the address was already
 * registered, so the reply cannot be used to enumerate accounts. But when the
 * project has email confirmation switched off, `supabase.auth.signUp` also
 * returns a session, the SSR client writes the cookies, and the visitor is
 * signed in before they have read the sentence telling them to check their
 * inbox. A hosted project with confirmations *on* stays on the form.
 *
 * Waiting for only one of those is how this helper failed the first time it
 * ran. It now waits for whichever arrives and signs in explicitly if needed —
 * so the suite behaves the same against CI's local stack and a developer's
 * hosted dev project, which is the whole point of a journey test.
 */
async function signUpAndIn(page: Page, email: string) {
  await page.goto(`${AUTH_URL}/login`, { waitUntil: 'networkidle' });
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();

  /*
   * Wait for whichever answer arrives, and swallow both rejections:
   * `Promise.race` settles on the first *settlement*, rejection included, so
   * racing two timeouts made a slow-but-fine notice look like a hard failure
   * and left the loser to reject unobserved.
   */
  await Promise.race([
    page
      .waitForURL((url) => !url.pathname.startsWith('/login'), {
        timeout: 20_000,
      })
      .catch(() => undefined),
    page
      .getByText(/confirmation link/i)
      .waitFor({ timeout: 20_000 })
      .catch(() => undefined),
  ]);

  /*
   * Then ask the application where this visitor stands, instead of inferring
   * it from the form.
   *
   * The first version clicked "Sign in" on the same form straight after the
   * sign-up submission and waited for a navigation that never came. Two things
   * were racing in that one page: the cookie the sign-up action had just set,
   * which makes Next re-render, and a second submission of the same form.
   * Navigating to `/` collapses both — it is one request whose answer is
   * unambiguous, because `/` redirects a signed-in visitor with no workspace to
   * `/onboarding` and an anonymous one to `/login`.
   */
  await page.goto(`${AUTH_URL}/`, { waitUntil: 'networkidle' });

  if (new URL(page.url()).pathname.startsWith('/login')) {
    // Not signed in, so the project requires email confirmation. Sign in
    // explicitly on a form that is not mid-action.
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page
      .waitForURL((url) => !url.pathname.startsWith('/login'), {
        timeout: 20_000,
      })
      .catch(() => undefined);
  }

  /*
   * One assertion for both paths, carrying whatever the page says.
   *
   * A bare timeout on a navigation reports that nothing happened and not why —
   * which is exactly what the first CI run produced. The status region holds
   * the action's own sentence ("email rate limit exceeded", "Email address … is
   * invalid"), and putting it in the failure message turns a dead end into a
   * diagnosis.
   */
  const stillOut = new URL(page.url()).pathname.startsWith('/login');
  if (stillOut) {
    const said = await page
      .locator('[role="status"], [role="alert"]')
      .first()
      .textContent()
      .catch(() => null);
    throw new Error(
      `Could not sign up and sign in as ${email}. The page said: ${said ?? '(nothing)'}`,
    );
  }

  await page.waitForLoadState('networkidle');
}

test.describe('a brand-new user with nothing configured', () => {
  // Serial, and sharing one page: see the block comment above.
  test.describe.configure({ mode: 'serial' });

  test.skip(
    !configured,
    'No SUPABASE_URL: this suite needs a real database and sign-up enabled.',
  );

  let page: Page;
  const identity = unique();

  test.beforeAll(async ({ browser }) => {
    /*
     * Guarded as well as `test.skip`ped. A describe-level skip stops the tests
     * but not necessarily this hook, so on a machine with no database the hook
     * would sign up against nothing and fail the file — which reads as a broken
     * suite rather than an absent prerequisite.
     */
    if (!configured) return;
    page = await browser.newPage();
    await signUpAndIn(page, identity.email);
  });

  test.afterAll(async () => {
    await page?.close();
  });

  test('an account with no workspace is sent to the gate', async () => {
    /*
     * The helper left this page on whatever `/` decided, so this asserts that
     * decision: a signed-in visitor with no workspace reaches the gate, not the
     * sample dashboard. It is the assertion that fails if `/` ever starts
     * rendering the sample home to somebody who has nothing.
     */
    await expect(page).toHaveURL(/\/onboarding$/, { timeout: 20_000 });
  });

  test('creating the workspace lands on the guided path', async () => {
    await page.getByLabel('Workspace name').fill(identity.workspace);
    await page.getByRole('button', { name: 'Create workspace' }).click();

    // The redirect that matters: a one-second-old workspace goes to the page
    // that names the next step, not to a projects list with no stated order.
    await expect(page).toHaveURL(new RegExp(`/${identity.slug}/start$`), {
      timeout: 20_000,
    });
  });

  test('opens on exactly one actionable step, with the rest waiting', async () => {
    /*
     * Three, not six.
     *
     * The four steps after GitHub described the legacy CLI pipeline —
     * repository, token, run, pull request — and the guardrail that is now the
     * product needs none of them. A new workspace connects GitHub and waits
     * for its first check; presenting four more as the path told every reader
     * the product was a command-line tool they had to drive.
     */
    await expect(page.getByTestId('onboarding-step')).toHaveCount(3);

    // Done: the workspace, and only the workspace.
    await expect(page.locator('[data-status="done"]')).toHaveCount(1);
    await expect(
      page.locator('[data-step="workspace"][data-status="done"]'),
    ).toBeVisible();
    await expect(page.getByText('1 of 3')).toBeVisible();

    /*
     * GitHub is where the reader is. Whether it reads `current` or `blocked`
     * depends on the deployment rather than the user: CI sets GITHUB_APP_ID and
     * GITHUB_APP_SLUG but no OAuth secret, so the honest answer there is that
     * this deployment cannot offer the flow at all. Both mean "you are here";
     * `todo` would be the bug — a step nobody can reach, presented as one to
     * get to later.
     */
    await expect(page.locator('[data-step="github"]')).toHaveAttribute(
      'data-status',
      /^(current|blocked)$/,
    );

    await expect(
      page.locator('[data-step="health_check"]'),
      'the first check',
    ).toHaveAttribute('data-status', 'todo');
  });

  /*
   * The step that is now the point of the page, and the one surface that tells
   * a reader the product runs without them.
   */
  test('names the health check as the destination, not a CLI run', async () => {
    const step = page.locator('[data-step="health_check"]');
    await expect(step).toContainText(/health check/i);

    // The legacy path is still reachable, and is named as the alternative it
    // is rather than as the path.
    await expect(
      page.getByRole('region', { name: /Translating in bulk/i }),
    ).toBeVisible();
  });

  test('says what is wrong rather than offering a control that cannot work', async () => {
    const github = page.locator('[data-step="github"]');
    const status = await github.getAttribute('data-status');

    if (status === 'blocked') {
      // The reason names the variables an operator would have to set — not
      // "something went wrong", and not a dead button with no explanation.
      const problem = github.getByTestId('step-problem');
      await expect(problem).toBeVisible();
      await expect(problem).toContainText(/GITHUB_|SUPABASE_/);
    } else {
      // Offered: exactly one way forward (DESIGN.md §8).
      await expect(
        github.getByRole('link', { name: /Connect GitHub/i }),
      ).toBeVisible();
    }
  });

  test('never paints an unreached step as needing a decision', async () => {
    /*
     * DESIGN.md §1.4 reserves Iris for "your judgement is required", and §6.3
     * says a thing that does not exist yet has no state at all. A fresh
     * workspace has no run, so nothing here may carry the colour. Asserted
     * against the rendered class because that is what a reader sees; the unit
     * test asserts the same rule against the data.
     */
    await expect(
      page.locator('[class*="ambiguous"]'),
      'Iris on a page where nothing is waiting on a human decision',
    ).toHaveCount(0);
  });

  test('explains the refusals a first run can hit, before it hits them', async () => {
    const refusals = page.getByTestId('refusal');
    await expect(refusals.first()).toBeVisible();
    expect(await refusals.count()).toBeGreaterThanOrEqual(8);

    const section = page.getByRole('region', {
      name: /If a run is refused/i,
    });
    // The six the brief names, each reachable by a first-time user.
    for (const status of ['401', '403', '412', '429', '502', '503']) {
      await expect(section, `status ${status}`).toContainText(status);
    }
    // 409 is the guard working, and must not be taught as a fault.
    await expect(section).toContainText('Not a failure');
  });

  test('is reachable from the projects page as well', async () => {
    await page.goto(`${AUTH_URL}/${identity.slug}/projects`, {
      waitUntil: 'networkidle',
    });
    /*
     * The pointer *is* the link now, so it is clicked rather than searched
     * inside.
     *
     * It used to be a paragraph — "New here? <link> — it says which step is
     * next and what each refusal means" — and the test reached through it with
     * `pointer.getByRole('link')`. The Phase 4 pass folded that sentence into
     * the link's own label and put the two workspace pointers in one row, so
     * `data-testid` moved onto the anchor. Looking for a link inside a link
     * found nothing and the click sat until the timeout.
     *
     * Asserting the role rather than just clicking: the point of this test is
     * that the guided path is *reachable* from the projects page, and a `div`
     * with a click handler would satisfy a bare click while being unreachable
     * by keyboard.
     */
    const pointer = page.getByTestId('start-here');
    await expect(pointer).toBeVisible();
    await expect(pointer).toHaveRole('link');
    await pointer.click();
    await expect(page).toHaveURL(new RegExp(`/${identity.slug}/start$`), {
      timeout: 20_000,
    });
  });

  test('issues a token once, for both shells', async () => {
    await page.goto(`${AUTH_URL}/${identity.slug}/tokens`, {
      waitUntil: 'networkidle',
    });
    await page.getByLabel('Name').fill('e2e onboarding');
    await page.getByRole('button', { name: 'Create token' }).click();

    const issued = page.getByTestId('issued-token');
    await expect(issued).toBeVisible({ timeout: 20_000 });

    /*
     * The regression this asserts: the panel used to print `export …` and
     * nothing else. `export` is a syntax error in PowerShell, the default shell
     * on Windows — half the audience was handed a paste that cannot run, and an
     * error that reads like a missing program rather than the wrong dialect.
     */
    await expect(issued.getByRole('tab', { name: 'PowerShell' })).toBeVisible();
    await expect(
      issued.getByRole('tab', { name: /macOS \/ Linux/ }),
    ).toBeVisible();

    await expect(issued).toContainText('export LOCALIZE_API_TOKEN=');
    await expect(issued).toContainText('npx @localize-infra/cli init');

    await issued.getByRole('tab', { name: 'PowerShell' }).click();
    await expect(issued).toContainText('$env:LOCALIZE_API_TOKEN =');
    // Radix unmounts the inactive tab, so the POSIX line is gone rather than
    // merely hidden — which is the point: no reader sees both dialects at once.
    await expect(issued).not.toContainText('export LOCALIZE_API_TOKEN');

    /*
     * This workspace has no repository, so the honest command is the
     * translate-only one, and the panel has to say so rather than emit
     * `--owner null`. A repository-connected workspace gets `--open-pr`, which
     * `commands.test.ts` pins; what is checked here is that the two cases are
     * distinguishable at all.
     */
    await expect(issued).toContainText('it does not open a pull request');
  });
});
