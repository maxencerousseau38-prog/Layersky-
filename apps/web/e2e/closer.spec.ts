import { type Page, expect, test } from '@playwright/test';
import {
  MEMBER_EMAIL,
  MEMBER_PASSWORD,
  OUTSIDER_EMAIL,
  OUTSIDER_PASSWORD,
  STORAGE_STATE,
} from './session';

/**
 * The operator's pipeline, against the seeded fixtures.
 *
 * ## What each fixture is for
 *
 * `supabase/seeds/dev-user.sql` opens four leads through the real functions:
 *
 *   **Partner Co** — design partner at `installed`, linked to a second
 *   organization that has an installation and three checks. The only fixture
 *   whose activation milestones can be read, and the link was written by
 *   `closer_link_activation` rather than by an UPDATE, so it had to satisfy the
 *   candidate check to exist at all.
 *
 *   **Noisy Co** — design partner, `installed → lost` with
 *   `installed_never_used`. The loss display.
 *
 *   **Sales Co** — the original motion, at `contacted`. Proves the two tracks
 *   coexist and that the filter separates them.
 *
 *   **Movable Co** — at `discovered`, and nothing else reads it. The stage
 *   change happens here because `fullyParallel` means a test that mutates a row
 *   another test asserts on cannot be made to win the race; `workspace.spec.ts`
 *   learned that by giving itself its own project.
 *
 * ## Why port 3212
 *
 * The same build with a real database, which is the only server where any of
 * this exists. They skip without `SUPABASE_URL` — and the `e2e` job fails
 * outright when that is empty, so skipping can no longer pass for passing.
 */
const DB_URL = 'http://127.0.0.1:3212';

const configured = Boolean(process.env.SUPABASE_URL);

test.use({
  baseURL: DB_URL,
  actionTimeout: 15_000,
  storageState: STORAGE_STATE,
});

test.skip(
  !configured,
  'No SUPABASE_URL. These need a database with supabase/seeds/dev-user.sql applied.',
);

async function open(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState('networkidle');
  await expect(page, 'the stored session did not authenticate').not.toHaveURL(
    /\/login/,
  );
}

/*
 * One section of the lead sheet.
 *
 * `PageSection` renders a bare `<section>` with an `<h2>`, so it is not a
 * `region` landmark and cannot be reached by accessible name. Scoping matters
 * here rather than being tidy: the loss reason appears twice on the page, in
 * the Lost panel and as a badge on the history row that produced it — both
 * correct — and an unscoped exact-text match fails on strict mode.
 */
function section(page: Page, name: string) {
  return page
    .locator('section')
    .filter({ has: page.getByRole('heading', { level: 2, name }) });
}

/** Open a lead's sheet by clicking its name in the pipeline. */
async function openLead(page: Page, name: string) {
  await open(page, '/closer/companies');
  await page
    .getByRole('link', { name: new RegExp(name, 'i') })
    .first()
    .click();
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
}

test.describe('the pipeline', () => {
  /*
   * The two tracks, in one navigation each.
   *
   * The assertion that matters is the *exclusion*: a filter that showed
   * everything would pass a test that only checked the expected row was
   * present, and a filter is worth nothing unless it leaves things out.
   */
  test('filters to the sales track, and leaves the design partners out', async ({
    page,
  }) => {
    await open(page, '/closer/companies?track=sales');

    await expect(page.getByText('Sales Co')).toBeVisible();
    await expect(page.getByText('Partner Co')).toHaveCount(0);
    await expect(page.getByText('Noisy Co')).toHaveCount(0);

    // The count is the filter's, not the page's.
    await expect(page.getByText('Matching')).toBeVisible();
  });

  test('filters to the design-partner track, and leaves sales out', async ({
    page,
  }) => {
    await open(page, '/closer/companies?track=design_partner');

    await expect(page.getByText('Partner Co')).toBeVisible();
    await expect(page.getByText('Noisy Co')).toBeVisible();
    await expect(page.getByText('Sales Co')).toHaveCount(0);
  });

  /*
   * A stage filter inside a track, and the empty state that is not the
   * "nothing discovered" one. Two empty states exist because they have
   * different remedies, and a test that only ever saw one would not notice the
   * wrong one being shown.
   */
  test('filters by stage, and says so when nothing matches', async ({
    page,
  }) => {
    await open(page, '/closer/companies?track=design_partner&stage=installed');
    await expect(page.getByText('Partner Co')).toBeVisible();
    await expect(page.getByText('Noisy Co')).toHaveCount(0);

    await open(page, '/closer/companies?track=sales&stage=negotiation');
    await expect(page.getByText(/no lead matches this filter/i)).toBeVisible();
    await expect(page.getByText(/nothing discovered yet/i)).toHaveCount(0);
  });
});

test.describe('the lead sheet', () => {
  /*
   * Activation, read across a tenant boundary.
   *
   * Every milestone is listed whatever its state — the point of
   * `deriveActivation` reporting five verdicts rather than a count — and the
   * three that product rows can speak to are reached, because the fixture's
   * linked workspace has an installation and three checks over three days and
   * three pull requests.
   */
  test('shows every activation milestone, and which ones the rows support', async ({
    page,
  }) => {
    /*
     * The one test here that needs more than a database, and in CI a missing
     * key is a **failure** rather than a skip.
     *
     * Activation is derived from the *prospect's* workspace, so
     * `closer_activation_metrics` is `service_role` only and the panel
     * honestly reports that it cannot be read without the key. Asserting the
     * milestones without it would be asserting the failure path and calling it
     * success.
     *
     * The first version skipped unconditionally and CI dutifully skipped it:
     * the job printed "SUPABASE_SERVICE_ROLE_KEY is set; the activation test
     * will run" and then did not run it. Both statements were true, of
     * different processes — `npm run test:e2e` goes through turbo, which
     * filters the environment to the variables declared under that task in
     * `turbo.json`, and this one was not among them. It reached the step and
     * not the worker.
     *
     * Declaring it in `turbo.json` fixes that instance; failing here makes the
     * class impossible, whatever the plumbing does later. The skip survives
     * for a developer, which is who it was for.
     */
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      expect(
        process.env.CI,
        'SUPABASE_SERVICE_ROLE_KEY did not reach the Playwright worker. In CI this test must run, not skip: skipped, it proves nothing about activation.',
      ).toBeFalsy();

      test.skip(
        true,
        'No SUPABASE_SERVICE_ROLE_KEY: the activation panel can only report that it cannot read.',
      );
    }

    await openLead(page, 'Partner Co');

    const activation = section(page, 'Activation');
    await expect(activation).toBeVisible();

    /*
     * The panel is in its readable state, asserted before anything is read off
     * it.
     *
     * Without this the test's non-vacuity rests on the milestone names being
     * absent from the failure state — true today, and true by accident. If the
     * panel ever rendered both the refusal and an empty milestone list, every
     * assertion below could pass against a page that read nothing. This was
     * observed failing in exactly that state: with no service-role key the
     * section renders one sentence and `Installed` resolved to nothing.
     */
    await expect(
      activation.getByText(/cannot be read|could not be read/i),
    ).toHaveCount(0);
    await expect(activation.getByText(/no workspace is linked/i)).toHaveCount(
      0,
    );

    /*
     * Scoped to the milestone list, and both narrowings were paid for.
     *
     * The section, because the Select primitive keeps a hidden native
     * `<select>` whose `<option>` text collides with every stage label on the
     * page: unscoped, `First check` resolved to `<option value="first_check">`.
     *
     * Then the list, because the section also carries the derived-stage
     * sentence — "The rows support **Repeated usage**" — so that one label
     * appeared twice inside the section and strict mode refused. That second
     * collision only existed because the panel was working: the sentence
     * renders solely when a stage was actually derived from the counters.
     */
    const milestoneRows = activation.getByRole('listitem');
    for (const milestone of [
      'Installed',
      'First check',
      'Repeated usage',
      'Pricing',
      'Paid',
    ]) {
      await expect(
        milestoneRows.getByText(milestone, { exact: true }),
      ).toBeVisible();
    }

    /*
     * And the derived stage itself, asserted rather than merely worked around.
     *
     * `derivedStage` is null unless the chain of milestones was walked and one
     * of them was reached, so this sentence existing is the positive evidence
     * that the counters were read — the thing the collision above revealed by
     * accident.
     */
    await expect(activation.getByText(/the rows support/i)).toBeVisible();

    // Reached, and the sentence quotes the observation behind it.
    await expect(
      page.getByText(/the github app is connected to the linked workspace/i),
    ).toBeVisible();
    await expect(page.getByText(/a check has run \(3 total\)/i)).toBeVisible();
    await expect(
      page.getByText(/3 check\(s\) across 3 day\(s\) and 3 pull request\(s\)/i),
    ).toBeVisible();

    /*
     * And the two that nothing records say so, rather than reading as refusals.
     * `paid` reported as "not reached" would describe every design partner as
     * having declined to pay — the distinction the third verdict state exists
     * for.
     */
    await expect(page.getByText(/operator judgement/i)).toBeVisible();
    await expect(page.getByText(/absence proves nothing/i)).toBeVisible();
  });

  /*
   * The loss, as two separate facts.
   *
   * `exit_stage` and `loss_reason` answer different questions — where it left
   * and why — and the whole of lot 5 is that the second one is countable. Both
   * are asserted, because showing one without the other is the state the
   * taxonomy replaced.
   */
  test('names where a lost lead left the funnel and why', async ({ page }) => {
    await openLead(page, 'Noisy Co');

    const lost = section(page, 'Lost');
    await expect(lost).toBeVisible();
    await expect(lost.getByText('Exit stage')).toBeVisible();
    await expect(lost.getByText('Loss reason')).toBeVisible();
    await expect(
      lost.getByText('Installed, never used', { exact: true }),
    ).toBeVisible();
    await expect(lost.getByText('Installed', { exact: true })).toBeVisible();

    // The free text the operator wrote is kept beside the countable value.
    await expect(
      lost.getByText('connected it and no check ever ran on a pull request', {
        exact: true,
      }),
    ).toBeVisible();

    // And the history carries the same transition.
    await expect(page.getByRole('heading', { name: 'History' })).toBeVisible();
    await expect(page.getByText('Installed → Lost')).toBeVisible();
  });

  /*
   * Approval is not offered as a stage, asserted where that means something.
   *
   * `Gated Co` sits at `ready_for_outreach`, the one stage with a real edge to
   * `outreach_approved`. Anywhere else the option is absent because the graph
   * has no such edge, and the test would credit the gate for a refusal that
   * came from the transition table.
   *
   * **The explanatory sentence is the proof of non-vacuity.** It renders only
   * when an option was removed, so its presence says the edge was there and
   * this surface withheld it — an absence on its own would also pass on a page
   * that failed to render the form.
   */
  test('never offers approval as a stage to type', async ({ page }) => {
    await openLead(page, 'Gated Co');

    await expect(page.getByRole('heading', { name: 'Move' })).toBeVisible();
    await expect(page.getByText(/approval is not in this list/i)).toBeVisible();

    await page.getByRole('combobox', { name: /move this lead to/i }).click();
    await expect(page.getByRole('option', { name: 'Approved' })).toHaveCount(0);

    // The moves that are legitimately available still are.
    await expect(page.getByRole('option', { name: 'Not a fit' })).toBeVisible();
  });
});

/*
 * The move, on the lead that exists to be moved.
 *
 * What proves it worked is the page afterwards — the new history row and the
 * reason — not the absence of an error, which a form that silently did nothing
 * would also produce. That exact failure shipped once here: a `'use server'`
 * module exporting a constant built cleanly and gave `/[org]/start` a button
 * that did nothing at runtime.
 */
test.describe('changing a stage', () => {
  /*
   * The destination is read off the form, and it is deliberately a *forward*
   * one.
   *
   * Two mistakes paid for here, in order. Hardcoding `Discovered → Qualified`
   * passed once and failed every later run against the same database, because
   * the lead is past `discovered` by then. Replacing it with
   * `getByRole('option').first()` was worse: the options come back in the
   * order `closer_stage_transitions` happens to return them, the first was
   * `Do not contact`, and that stage is absorbing — the test moved the fixture
   * somewhere nothing can leave and could never run again. The database said
   * so plainly: `legal_moves_on_track = 0`.
   *
   * So the terminals are excluded by name. A forward move walks the chain one
   * step per run, which is finite but never absorbing, and CI rebuilds its
   * stack each job anyway.
   */
  const TERMINAL_LABELS = [
    'Not a fit',
    'Not now',
    'Unresponsive',
    'Lost',
    'Do not contact',
  ];

  test('moves a lead through the one writer, and records the reason', async ({
    page,
  }) => {
    await openLead(page, 'Movable Co');

    await page.getByRole('combobox', { name: /move this lead to/i }).click();

    const options = page.getByRole('option');
    await expect(options.first()).toBeVisible();
    const labels = (await options.allTextContents()).map((t) => t.trim());
    const destination = labels.find((l) => !TERMINAL_LABELS.includes(l));
    expect(
      destination,
      `the form offered only terminals: ${labels.join(', ')}`,
    ).toBeTruthy();
    await page.getByRole('option', { name: destination }).click();

    /*
     * Unique per run, and both halves of that were learned the hard way.
     *
     * Prefixing it "Moved to" collided with the action's own success sentence.
     * Then a constant reason collided with *itself*: the history is append-only
     * and accumulates across runs, so the same sentence resolved to two rows
     * and strict mode refused. A nonce makes the assertion identify the row
     * this run wrote rather than any row that ever said the same thing.
     */
    const reason = `Acceptance suite advanced this to ${destination} #${Date.now()}`;
    await page
      .getByRole('textbox', { name: /why this lead is moving/i })
      .fill(reason);

    await page.getByRole('button', { name: /move lead/i }).click();
    await expect(section(page, 'Move').getByText(/^Moved to /)).toBeVisible();

    /*
     * Reloaded, because what proves the write landed is the row coming back
     * out of the database — not the optimistic sentence the action returned.
     */
    await page.reload();
    await page.waitForLoadState('networkidle');

    /*
     * Scoped to History, and `.first()` because substring matching resolves to
     * both the row's own span and the `<li>` that wraps it. That is a DOM
     * artefact rather than an ambiguity about the fact being asserted: a
     * history row recording this move exists.
     */
    await expect(
      section(page, 'History').getByText(`→ ${destination}`).first(),
    ).toBeVisible();
    await expect(page.getByText(reason, { exact: true })).toBeVisible();
  });

  /*
   * The refusal the taxonomy exists for, and it is safe to aim at a shared
   * fixture.
   *
   * A refused move writes nothing — no stage, no history row — so this cannot
   * race the activation test that reads the same lead. `installed → lost` is a
   * real edge, which is what makes the refusal come from the loss-reason guard
   * rather than from the transition graph; `closer-track.sql` was once fooled
   * exactly that way, asserting a refusal that came from a missing edge.
   *
   * The sentence asserted is the database's. The client marks the field
   * required too, but a server action is an endpoint and the guard that counts
   * is the raise in `closer_set_stage`.
   */
  test('refuses to lose a lead without a reason, in the product’s own words', async ({
    page,
  }) => {
    await openLead(page, 'Partner Co');

    await page.getByRole('combobox', { name: /move this lead to/i }).click();
    await page.getByRole('option', { name: 'Lost' }).click();

    // The loss-reason field appears, and says it is required.
    await expect(page.getByText(/a reason is required here/i)).toBeVisible();

    await page
      .getByRole('textbox', { name: /why this lead is moving/i })
      .fill('Trying to close this without saying why');

    await page.getByRole('button', { name: /move lead/i }).click();

    await expect(
      page.getByText(/moving a lead to lost needs a loss reason/i),
    ).toBeVisible();

    // And the lead did not move.
    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('Installed → Lost')).toHaveCount(0);
  });
});

/*
 * The gate, from the outside.
 *
 * `/closer/*` is protected by `CloserLayout`, which calls `hasCloser()` and
 * then `notFound()`. `hasCloser()` selects from `closer_workspaces` **under
 * RLS** (`closer_workspaces_select_member` → `is_org_member(organization_id)`),
 * so the database decides and no identity is hardcoded anywhere.
 *
 * Nothing proved the refusal until now. Every test above runs as the seeded
 * account, which *is* a Closer member, so the suite demonstrated the feature
 * working and said nothing about who it keeps out — and an operator surface
 * carrying a sales pipeline is exactly where that silence is expensive.
 *
 * The subject is `intruder@localize-infra.dev`: a real seeded account, signed
 * in properly, owning an organization that has no `closer_workspaces` row. Not
 * an anonymous visitor — `auth.spec.ts` covers those, and a 404 for someone who
 * was never authenticated would prove nothing about authorisation.
 *
 * **Fixtures only, and no authorisation rule was touched to make this pass.**
 * The identity already existed in the seed for `tenant-isolation.sql`; all that
 * was added is its name in `session.ts`.
 *
 * Deliberately *not* asserted here: a **member of the Closer organization**
 * does see Closer, because the policy admits any `is_org_member`. That is the
 * policy's current meaning rather than a bug this test could settle, it is
 * reported as a decision for a human, and asserting either answer would freeze
 * a choice nobody has made.
 */
test.describe('an authenticated user outside the Closer workspace', () => {
  // A blank context, so the shared Closer session cannot leak in. The sign-in
  // below is the test's own precondition.
  test.use({ storageState: { cookies: [], origins: [] } });

  test('is refused every Closer route, and shown no pipeline data', async ({
    page,
  }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(OUTSIDER_EMAIL);
    await page.getByLabel('Password').fill(OUTSIDER_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL((url) => !url.pathname.startsWith('/login'), {
      timeout: 30_000,
    });

    /*
     * Signed in for real, proved by a surface this account *is* entitled to.
     *
     * This is the precondition the whole test rests on: without it the 404s
     * below would be indistinguishable from an anonymous visitor being
     * bounced, and the test would be about routing rather than authorisation.
     *
     * Asserted against `intruder-co`, the organization this account owns,
     * rather than against a "Sign out" control — which is not on the page the
     * login redirect lands on. One session, two answers: 200 for what it owns,
     * 404 for Closer. That contrast is the whole point.
     */
    const own = await page.goto('/intruder-co/projects');
    expect(own?.status(), 'the outsider cannot reach its own workspace').toBe(
      200,
    );

    for (const path of [
      '/closer',
      '/closer/companies',
      '/closer/approvals',
      '/closer/replies',
    ]) {
      const response = await page.goto(path);

      // 404, not a redirect and not an empty 200: `notFound()` is the product's
      // chosen answer, and it is the one that does not confirm the surface
      // exists.
      expect(response?.status(), `${path} did not answer 404`).toBe(404);

      /*
       * And nothing from the pipeline on the page. A 404 status with the shell
       * still rendering lead names would be the leak the status appears to
       * rule out, so the body is checked rather than trusted.
       *
       * These four companies are the seeded fixtures named at the top of this
       * file. All synthetic — no real prospect or customer appears in any
       * fixture.
       */
      /*
       * `innerText`, not `textContent`. The latter includes the contents of
       * `<script>` tags, so it returns Next's RSC flight payload — which
       * mentions "pipeline" from the client bundle and would fail this
       * assertion on noise rather than on a leak. What matters is what a
       * person can see.
       */
      const body = (await page.locator('body').innerText()).replace(
        /\s+/g,
        ' ',
      );
      for (const seeded of [
        'Partner Co',
        'Noisy Co',
        'Sales Co',
        'Movable Co',
      ]) {
        expect(
          body,
          `${path} leaked the seeded lead "${seeded}"`,
        ).not.toContain(seeded);
      }
      /*
       * Nor Closer's own vocabulary, which would say the surface rendered.
       *
       * Narrow on purpose. The 404 is served *inside* the application shell,
       * whose sidebar legitimately carries a section headed "PIPELINE" — the
       * customer's own i18n nav (Home, Ambiguity, Review, Runs, Locales). A
       * test that forbade the word "pipeline" failed on that shell rather than
       * on any leak, which is the opposite of useful. These terms appear only
       * on Closer surfaces: its nav labels, and the taxonomy of
       * `packages/closer-core`.
       */
      for (const term of [
        'Companies',
        'Approvals',
        'Replies',
        'loss reason',
        'design partner',
      ]) {
        expect(body, `${path} rendered the Closer term "${term}"`).not.toMatch(
          new RegExp(term, 'i'),
        );
      }
    }
  });
});

/*
 * A member of the workspace Closer runs in, which is the case that mattered.
 *
 * The outsider test above proves tenancy. This proves **authorisation**, and it
 * is the harder half: `member@localize-infra.dev` is a `member` of
 * `acceptance`, the organization `closer_workspaces` designates. Until
 * `20261010000100_closer_operators.sql` that was enough — all twelve select
 * policies and all twenty write functions gated on
 * `is_org_member(organization_id)`, so this account could read every company,
 * contact, lead, message, reply, loss reason and internal note, and could call
 * `closer_set_stage` over PostgREST.
 *
 * Membership is now necessary and not sufficient: `is_closer_operator` requires
 * a row in `closer_operators`, and the seed deliberately gives this account
 * none.
 *
 * The database half is proved in `supabase/tests/closer-operators.sql`, which
 * is where the write path and the per-table reads are checked — a browser
 * cannot make the PostgREST call that mattered. This is the surface half: the
 * routes answer 404 and leak nothing.
 */
test.describe('an ordinary member of the Closer workspace', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('is refused Closer, although it belongs to the workspace', async ({
    page,
  }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(MEMBER_EMAIL);
    await page.getByLabel('Password').fill(MEMBER_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL((url) => !url.pathname.startsWith('/login'), {
      timeout: 30_000,
    });

    /*
     * The precondition, and here it carries more weight than in the outsider
     * test: this account must demonstrably be *inside* `acceptance`. A 404 on
     * Closer proves authorisation only if membership is established, otherwise
     * it is indistinguishable from the tenancy refusal already covered above.
     */
    const own = await page.goto('/acceptance/projects');
    expect(
      own?.status(),
      'the member cannot reach the workspace it belongs to',
    ).toBe(200);

    for (const path of [
      '/closer',
      '/closer/companies',
      '/closer/approvals',
      '/closer/replies',
    ]) {
      const response = await page.goto(path);
      expect(response?.status(), `${path} did not answer 404`).toBe(404);

      const body = (await page.locator('body').innerText()).replace(
        /\s+/g,
        ' ',
      );
      for (const seeded of [
        'Partner Co',
        'Noisy Co',
        'Sales Co',
        'Movable Co',
      ]) {
        expect(
          body,
          `${path} leaked the seeded lead "${seeded}" to a member`,
        ).not.toContain(seeded);
      }
      for (const term of ['Companies', 'Approvals', 'Replies', 'loss reason']) {
        expect(
          body,
          `${path} rendered the Closer term "${term}" for a member`,
        ).not.toMatch(new RegExp(term, 'i'));
      }
    }
  });
});
