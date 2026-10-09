import { expect, test } from '@playwright/test';

const ROUTES = ['/', '/review', '/runs', '/locales', '/settings', '/design'];

/**
 * The guard that matters most in this file.
 *
 * A misconfigured Content-Security-Policy once blocked every Next.js chunk on
 * apps/site. The build was green, every page prerendered, and the accessibility
 * audit passed — because all of that inspects static markup. The site was
 * simply dead: nothing hydrated, no button worked.
 *
 * This app carries a stricter, nonce-based policy generated per request, so the
 * same failure is *more* likely here, not less: a nonce that fails to reach
 * Next's script tags blocks everything. Nothing in a typical pipeline catches
 * that. This does.
 */
test.describe('runtime health', () => {
  for (const route of ROUTES) {
    test(`${route} loads with no console errors or CSP violations`, async ({
      page,
    }) => {
      const errors: string[] = [];
      page.on('console', (m) => {
        if (m.type() === 'error') errors.push(m.text());
      });
      page.on('pageerror', (e) => errors.push(`pageerror: ${String(e)}`));

      await page.goto(route, { waitUntil: 'networkidle' });
      expect(errors).toEqual([]);
    });
  }

  test('serves a nonce-based CSP with no unsafe-inline for scripts', async ({
    page,
  }) => {
    const response = await page.goto('/', { waitUntil: 'domcontentloaded' });
    const csp = response?.headers()['content-security-policy'] ?? '';
    const scriptSrc =
      csp.split(';').find((d) => d.trim().startsWith('script-src')) ?? '';

    expect(scriptSrc).toMatch(/'nonce-[a-f0-9]{32}'/);
    expect(scriptSrc).toContain("'strict-dynamic'");
    // `object-src 'none'` and `base-uri 'self'` are the two directives
    // 'strict-dynamic' does not cover; a policy missing them is not strict.
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
  });

  test('issues a different nonce on every request', async ({ page }) => {
    // A constant nonce is equivalent to no nonce at all: an attacker who can
    // read one page can reuse it. This is the failure a static header hides.
    const first = await page.goto('/', { waitUntil: 'domcontentloaded' });
    const a = first?.headers()['content-security-policy'] ?? '';
    const second = await page.goto('/design', {
      waitUntil: 'domcontentloaded',
    });
    const b = second?.headers()['content-security-policy'] ?? '';

    const nonceOf = (csp: string) => csp.match(/'nonce-([a-f0-9]{32})'/)?.[1];
    expect(nonceOf(a)).toBeTruthy();
    expect(nonceOf(a)).not.toBe(nonceOf(b));
  });

  test('React is running: the command palette opens on click', async ({
    page,
  }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: /search/i }).click();
    await expect(page.getByRole('combobox')).toBeFocused();
  });
});

test.describe('command palette', () => {
  test('opens with the keyboard shortcut, filters, and navigates', async ({
    page,
  }) => {
    await page.goto('/', { waitUntil: 'networkidle' });

    await page.keyboard.press('ControlOrMeta+k');
    const input = page.getByRole('combobox');
    await expect(input).toBeFocused();

    // An empty query must list everything, never a blank box.
    await expect(page.getByRole('option')).not.toHaveCount(0);

    /*
     * `locales`, not `design`.
     *
     * This filtered for "design" and navigated to the component gallery,
     * which is the one route the palette must now *not* offer: `/design` is a
     * development surface, it was taken out of the sidebar when that was
     * decided, and the palette was the last place still advertising it to a
     * customer. The route is untouched — line 158 below still opens it
     * directly and it still resolves in the breadcrumb.
     *
     * The subject of this test is filtering and navigating, not which entry
     * it lands on, so it keeps both with a route that belongs in a customer's
     * palette.
     */
    await input.fill('locales');
    await expect(page.getByRole('option')).toHaveCount(1);
    await page.keyboard.press('Enter');

    await expect(page).toHaveURL(/\/locales$/);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Locales' }),
    ).toBeVisible();
  });

  /*
   * The gallery is unlisted, and this is what "unlisted" has to mean.
   *
   * Non-vacuous by construction: the same query that must find nothing here
   * found exactly one option until this pass, which is what the test above
   * used to navigate with.
   */
  test('does not offer the internal component gallery', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await page.keyboard.press('ControlOrMeta+k');
    await expect(page.getByRole('combobox')).toBeFocused();

    await page.getByRole('combobox').fill('design system');
    await expect(page.getByRole('option')).toHaveCount(0);
  });

  test('the shortcut toggles: pressing it again closes the palette', async ({
    page,
  }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await page.keyboard.press('ControlOrMeta+k');
    await expect(page.getByRole('combobox')).toBeFocused();

    // A shortcut that only opens leaves the reader pressing it with nothing
    // happening (design system §4.6: ⌘K toggles).
    await page.keyboard.press('ControlOrMeta+k');
    await expect(page.getByRole('combobox')).toHaveCount(0);
  });

  test('Escape closes it and returns focus to the trigger', async ({
    page,
  }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    const trigger = page.getByRole('button', { name: /search/i });
    await trigger.click();
    await expect(page.getByRole('combobox')).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(page.getByRole('combobox')).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });

  test('arrow keys move the active option without moving focus', async ({
    page,
  }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await page.keyboard.press('ControlOrMeta+k');
    const input = page.getByRole('combobox');

    const firstActive = await input.getAttribute('aria-activedescendant');
    await page.keyboard.press('ArrowDown');
    const secondActive = await input.getAttribute('aria-activedescendant');

    expect(firstActive).toBeTruthy();
    expect(secondActive).not.toBe(firstActive);
    // The whole point of aria-activedescendant: focus stays where typing goes.
    await expect(input).toBeFocused();
  });
});

test('the skip link is the first thing a keyboard user reaches', async ({
  page,
}) => {
  await page.goto('/', { waitUntil: 'networkidle' });
  await page.keyboard.press('Tab');
  await expect(
    page.getByRole('link', { name: /skip to content/i }),
  ).toBeFocused();
});

test('theme choice persists across navigation', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /^colour theme/i }).click();
  await page.getByRole('menuitemradio', { name: 'Dark' }).click();
  await expect(page.locator('html')).toHaveClass(/dark/);

  await page.goto('/design', { waitUntil: 'networkidle' });
  // Applied before first paint by the inline theme script, which only runs if
  // the per-request nonce reached it.
  await expect(page.locator('html')).toHaveClass(/dark/);
});

/*
 * The sample-honesty suite is gone with the sample data.
 *
 * It asserted that /, /ambiguity, /review, /runs and /runs/run-7c1b each
 * carried a "this is not your project" banner, a breadcrumb chip and a labelled
 * data region. Four of those five now read Postgres and have no sample to
 * label; run-7c1b was a fixture id and is a 404.
 *
 * `/` still renders the sample dashboard — but only when no database is
 * configured, which is this suite's server. That one route keeps its banner,
 * and the assertion for it lives in the honesty check below.
 */
test('the sample dashboard says so when there is no database', async ({
  page,
}) => {
  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(
    page.getByText(/sample data — this is not your project/i),
  ).toBeVisible();
});

test('remains usable with reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/design', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Open dialog' }).click();
  await expect(
    page.getByRole('heading', { name: /disconnect this project/i }),
  ).toBeVisible();
});

/**
 * The layout contract puts the sidebar at ≥1024 and the page gutter at 16px
 * below 768 (docs/product/04-wireframes.md §0). Below the breakpoint the same
 * navigation becomes a sheet — the one thing a fixed 240px sidebar cannot do on
 * a phone is get out of the way.
 */
test.describe('responsive shell', () => {
  test('below 1024 the sidebar is replaced by a navigation sheet', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/', { waitUntil: 'networkidle' });

    // Exactly one "Main" navigation landmark must be present at any width, or a
    // screen reader announces two navigations with identical names.
    await expect(page.getByRole('navigation', { name: 'Main' })).toHaveCount(0);

    await page.getByRole('button', { name: /toggle sidebar/i }).click();
    const nav = page.getByRole('navigation', { name: 'Main' });
    await expect(nav).toBeVisible();
    await expect(nav).toHaveCount(1);

    /*
     * `Runs`, not `Design system`.
     *
     * This clicked the component gallery, which is no longer in the
     * navigation: `/design` is a development surface and was moved out of the
     * customer's menu into `INTERNAL_NAV`, reachable by URL and by ⌘K. The
     * route still works; it is simply not advertised, so a test clicking it in
     * the sheet had nothing to click.
     *
     * The subject here is that selecting a destination dismisses the sheet.
     * Any navigation entry proves that, and `Runs` is in the Pipeline group at
     * every width and for every reader — including one with no workspace,
     * where the Workspace group is not rendered at all.
     */
    await nav.getByRole('link', { name: 'Runs' }).click();
    await expect(page).toHaveURL(/\/runs$/);
    // Selecting a destination must dismiss the sheet, or the reader lands on
    // the new page with the navigation still covering it.
    await expect(page.getByRole('navigation', { name: 'Main' })).toHaveCount(0);
  });

  test('at 1024 and above the sidebar is persistent', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/', { waitUntil: 'networkidle' });

    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
    await expect(
      page.getByRole('button', { name: /toggle sidebar/i }),
    ).toBeVisible();
  });

  /*
   * Measures the scroll container, not just the document — and every route,
   * not just /design.
   *
   * The previous version did neither, and missed a real one. The app shell puts
   * content inside `main.overflow-y-auto`, and `overflow-y: auto` makes
   * `overflow-x` auto too, so `main` silently absorbs sideways overflow and the
   * document reports zero. The run detail measured 828px inside a 390px
   * viewport — its `Pull request` button sat at x=678, off-screen — while this
   * test passed.
   */
  const ROUTES = [
    '/',
    '/runs',
    '/runs/run-8f2a',
    '/runs/run-6a09',
    '/locales',
    '/review',
    '/settings',
    '/design',
  ];

  for (const width of [390, 1440]) {
    test(`nothing scrolls sideways at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      const bad: string[] = [];

      for (const route of ROUTES) {
        await page.goto(route, { waitUntil: 'networkidle' });
        const over = await page.evaluate(() => {
          const doc = document.documentElement.scrollWidth - window.innerWidth;
          const main = document.querySelector('main');
          const inner = main ? main.scrollWidth - main.clientWidth : 0;
          return Math.max(doc, inner);
        });
        if (over > 0) bad.push(`${route} +${over}px`);
      }

      expect(bad).toEqual([]);
    });
  }
});

/*
 * The run-detail suite needed the same fixture as data-surface.spec.ts.
 *
 * It navigated to /runs/run-7c1b — a fixture id — and asserted the pipeline
 * stages, their assistive-technology labels and a verbatim provider error. All
 * three still matter and all three now require a real run in a real workspace:
 * the page reads `runs`, `run_translations` and `run_ambiguities`.
 *
 * Not silently dropped. The properties are restated in the skipped block in
 * data-surface.spec.ts, which names the missing fixture; re-adding them is part
 * of the same piece of work.
 */

test.describe('command palette actions', () => {
  test('offers navigation, actions and help', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await page.keyboard.press('ControlOrMeta+k');

    const list = page.getByRole('listbox');
    for (const section of ['Navigation', 'Actions', 'Help']) {
      await expect(
        list.getByRole('group', { name: section }),
        `${section} section`,
      ).toBeAttached();
    }
  });

  test('a theme action actually changes the theme', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await expect(page.locator('html')).not.toHaveClass(/dark/);

    await page.keyboard.press('ControlOrMeta+k');
    await page.getByRole('combobox').fill('dark');
    await page.keyboard.press('Enter');

    // The point of shipping actions at all: they run.
    await expect(page.locator('html')).toHaveClass(/dark/);
  });

  test('the topbar toggle stays in sync with the palette', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/', { waitUntil: 'networkidle' });

    await page.keyboard.press('ControlOrMeta+k');
    await page.getByRole('combobox').fill('dark');
    await page.keyboard.press('Enter');

    // Two surfaces can set the theme. Before they shared a store, the toggle
    // read localStorage once on mount and kept showing the old value.
    //
    // Asserted on the trigger's accessible name rather than a checked option:
    // the toggle is one control with a menu now (DESIGN.md §9), and its
    // options are not in the DOM while it is closed. This is the stronger
    // check anyway — it is what a screen reader reads without opening
    // anything.
    await expect(
      page.getByRole('button', { name: /^colour theme/i }),
    ).toHaveAccessibleName('Colour theme: Dark');
  });

  test('the theme survives a reload after a palette change', async ({
    page,
  }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await page.keyboard.press('ControlOrMeta+k');
    await page.getByRole('combobox').fill('dark');
    await page.keyboard.press('Enter');

    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.locator('html')).toHaveClass(/dark/);
  });

  test('offers no action it cannot perform', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await page.keyboard.press('ControlOrMeta+k');
    const list = page.getByRole('listbox');

    // Extraction, translation, opening a pull request and approving a
    // suggestion all need a backend. A palette that offers a command it cannot
    // run is worse than one that offers fewer.
    for (const forbidden of [
      /run extraction/i,
      /translate/i,
      /open a pull request/i,
      /approve/i,
      /resolve/i,
    ]) {
      await expect(
        list.getByRole('option', { name: forbidden }),
        String(forbidden),
      ).toHaveCount(0);
    }
  });
});

/*
 * The gate, asserted from the side where it must hold.
 *
 * This server runs with no database, so `hasCloser()` cannot find a row and the
 * group must be absent from the markup entirely — not present and hidden, which
 * is a different and much weaker thing. A customer signing in to the real
 * application is in the same position as this page: not a member of a workspace
 * with Closer.
 */
test('Closer is not reachable without an entitled workspace', async ({
  page,
}) => {
  // This server runs with no database, so `hasCloser()` can find no row. A 404
  // is the only answer that does not confirm the route exists.
  //
  // Every route under /closer, not only the index. The gate is in the shared
  // layout, so one 404 is evidence for the others — but the lead sheet arrived
  // later than this test and a route added outside the layout would be caught
  // by nothing. A uuid that could not exist, so a 404 can only be the gate.
  for (const path of [
    '/closer',
    '/closer/companies',
    '/closer/leads/00000000-0000-0000-0000-000000000000',
  ]) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(404);
  }

  // And nothing anywhere in the shell points at it.
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: 'Main' });
  await expect(nav).toBeVisible();
  await expect(nav.getByText('Closer')).toHaveCount(0);
});
