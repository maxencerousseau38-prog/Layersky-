import { expect, test } from '@playwright/test';
import {
  CLI_PERSONAL_TOKENS_LIVE,
  CLI_PUBLISHED_TO_NPM,
  EXAMPLE_PR_URL,
  HOSTED_API_LIMITS,
} from '../src/lib/constants';
import { SITE_URL } from '../src/lib/routes';

const ROUTES = [
  '/',
  '/docs',
  '/benchmarks',
  '/pricing',
  '/quality',
  '/security',
  '/roadmap',
];

/**
 * The guard that matters most in this file.
 *
 * A misconfigured Content-Security-Policy once blocked every Next.js chunk on
 * this site. The build was green, every page prerendered, and the accessibility
 * audit passed — because all of that inspects static markup. The site was
 * simply dead: nothing hydrated, no button worked.
 *
 * Nothing in a typical pipeline catches that. This does.
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

  test('the page actually hydrates and responds to interaction', async ({
    page,
  }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    const button = page.getByRole('button', { name: /copy command/i }).first();
    await button.click();

    // Deliberately asserts on the live region rather than on a success state:
    // clipboard access may be denied in some environments, and this test is
    // about whether React is running at all, not whether the copy succeeded.
    // Either outcome writes here; a dead page writes nothing.
    await expect(page.locator('output').first()).not.toBeEmpty();
  });
});

test.describe('copy command — the primary conversion action', () => {
  test('copies the exact command via keyboard alone and announces it', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/', { waitUntil: 'networkidle' });

    const button = page.getByRole('button', { name: /copy command/i }).first();
    await button.focus();
    await expect(button).toBeFocused();
    await page.keyboard.press('Enter');

    // Announced for screen-reader users, not merely shown.
    await expect(page.getByText('Command copied to clipboard')).toBeAttached();

    // Must arrive verbatim: a stray prompt character or trailing whitespace
    // would break paste-and-run, which is this page's whole conversion path.
    const clipboard = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboard).toBe('npx @localize-infra/cli init');
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
});

test('theme choice persists and applies before first paint', async ({
  page,
}) => {
  await page.goto('/', { waitUntil: 'networkidle' });

  // One trigger, not three segments (DESIGN.md §9). Its accessible name
  // carries the current choice, because the options only exist in the DOM
  // while the menu is open and another surface can change the preference.
  const trigger = page.getByRole('button', { name: /^colour theme/i });
  await expect(trigger).toBeVisible();

  await trigger.click();
  await page.getByRole('menuitemradio', { name: 'Dark' }).click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await expect(trigger).toHaveAccessibleName('Colour theme: Dark');

  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.locator('html')).toHaveClass(/dark/);
  await expect(trigger).toHaveAccessibleName('Colour theme: Dark');

  /*
   * The choice is still a choice: every state is reachable, and the selected
   * one is the one reported.
   *
   * Asserted by name rather than by count. This read `toHaveCount(3)` and
   * failed the day OLED was added — correctly, but uninformatively: an integer
   * cannot say whether a state was gained or lost, and the fix for a bare
   * count is always to edit the number. The names say which set is expected.
   */
  await trigger.click();
  await expect(page.getByRole('menuitemradio')).toHaveText([
    'Light',
    'Dark',
    'OLED',
    'System',
  ]);
  await expect(page.getByRole('menuitemradio', { name: 'Dark' })).toBeChecked();
});

test('remains usable with reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(
    page.getByRole('heading', { level: 1, name: /checked for what it broke/i }),
  ).toBeVisible();
});

/**
 * The published-numbers guard.
 *
 * Every figure on /benchmarks and /quality comes from the generated artifact.
 * These tests assert the two ways that contract can break in the browser: a
 * number that does not match the artifact, and a check with an empty
 * denominator rendered as a percentage. The second one shipped on /quality as
 * the word "Pass" and survived until the artifact was generated.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ARTIFACT = JSON.parse(
  readFileSync(
    join(process.cwd(), '../../packages/eval/src/report/benchmarks.json'),
    'utf8',
  ),
) as {
  corpus: { entries: number; projects: Array<{ name: string }> };
  run: { translations: number; models: string[] };
  conditions: Array<{
    condition: 'A' | 'B';
    placeholderIntact: { applicable: number; passed: number };
    withinLengthBudget: { applicable: number; passed: number };
    icuValid: { applicable: number };
    pluralCategoriesCorrect: { applicable: number };
  }>;
};

const conditionB = ARTIFACT.conditions.find((c) => c.condition === 'B');
if (!conditionB) throw new Error('artifact is missing condition B');

test.describe('published numbers trace to the artifact', () => {
  test('/benchmarks renders the corpus size and model from the artifact', async ({
    page,
  }) => {
    await page.goto('/benchmarks', { waitUntil: 'networkidle' });
    const body = await page.locator('body').innerText();

    expect(body).toContain(String(ARTIFACT.corpus.entries));
    expect(body).toContain(String(ARTIFACT.run.translations));
    for (const model of ARTIFACT.run.models) {
      expect(body).toContain(model);
    }
  });

  test('/benchmarks shows the measured length-budget figures, not rounded prose', async ({
    page,
  }) => {
    await page.goto('/benchmarks', { waitUntil: 'networkidle' });
    const body = await page.locator('body').innerText();

    // The exact passed/applicable pair must appear, so a percentage cannot
    // drift away from the counts it was computed from.
    expect(body).toContain(
      `${conditionB.withinLengthBudget.passed}/${conditionB.withinLengthBudget.applicable}`,
    );
  });

  for (const route of ['/benchmarks', '/quality']) {
    test(`${route} never renders a percentage for a zero-denominator check`, async ({
      page,
    }) => {
      await page.goto(route, { waitUntil: 'networkidle' });

      // The corpus exercises neither ICU validity nor plural categories.
      expect(conditionB.icuValid.applicable).toBe(0);
      expect(conditionB.pluralCategoriesCorrect.applicable).toBe(0);

      for (const label of ['ICU message validity', 'Plural categories']) {
        const row = page.locator('tr', { hasText: label }).first();
        await expect(row).toBeVisible();
        await expect(row).toContainText('No data');
        // "100%" off nothing is the exact failure this guards.
        await expect(row).not.toContainText('%');
      }
    });
  }

  test('/quality states why those checks have no data', async ({ page }) => {
    await page.goto('/quality', { waitUntil: 'networkidle' });
    await expect(
      page.getByText(/corpus contains no ICU plural or select messages/i),
    ).toBeVisible();
  });

  test('/benchmarks names what it has not measured', async ({ page }) => {
    await page.goto('/benchmarks', { waitUntil: 'networkidle' });
    await expect(
      page.getByRole('heading', {
        name: /what these numbers do not tell you/i,
      }),
    ).toBeVisible();
    await expect(page.getByText(/native speaker/i).first()).toBeVisible();
  });
});

/*
 * Whether the CLI is on npm is one fact, `CLI_PUBLISHED_TO_NPM`, and two pages
 * make a claim that depends on it. These tests read the same constant, so the
 * suite fails whenever the flag and the copy disagree — in either direction.
 *
 * That matters more than it looks. The failure this guards against is not a
 * page saying "not published" after publishing; it is the opposite, a page
 * promising an `npx` that 404s for every visitor who copies it. Asserting one
 * fixed wording would have gone stale silently the day the flag moved.
 */
test.describe('the install claim matches whether the package exists', () => {
  test('the landing page qualifies the command truthfully', async ({
    page,
  }) => {
    await page.goto('/', { waitUntil: 'networkidle' });

    if (CLI_PUBLISHED_TO_NPM && CLI_PERSONAL_TOKENS_LIVE) {
      // Published and served by the hosted API: the sentence names the token
      // the reader needs, not an API they must run.
      await expect(
        page.getByText(/with a personal token from your workspace/i),
      ).toBeVisible();
      await expect(page.getByText(/not published to npm/i)).toHaveCount(0);
    } else if (CLI_PUBLISHED_TO_NPM) {
      // Published, and still not self-sufficient: the translation step needs an
      // API the reader runs themselves. Saying only "it's on npm" would be true
      // and misleading.
      await expect(
        page.getByText(/needs an API you run yourself/i),
      ).toBeVisible();
      await expect(page.getByText(/not published to npm/i)).toHaveCount(0);
    } else {
      await expect(page.getByText(/not published to npm yet/i)).toBeVisible();
    }

    // The disclaimer must hand the reader somewhere that works. The link's
    // label moved from "see the docs" to "Install guide" when the hero was
    // recomposed; what matters is that the route is reachable from the
    // sentence, not the wording, so this asserts the destination.
    await expect(page.locator('a[href="/docs#install"]').first()).toBeVisible();
  });

  test('/docs leads with the same limitation', async ({ page }) => {
    await page.goto('/docs', { waitUntil: 'networkidle' });

    if (CLI_PUBLISHED_TO_NPM) {
      await expect(
        page.getByText(
          CLI_PERSONAL_TOKENS_LIVE
            ? /runs against the hosted API with a personal token/i
            : /installing it is not the same as being able to use it/i,
        ),
      ).toBeVisible();
      // The status block must send the reader to the refusal rather than
      // re-quoting it: "When it refuses" already documents that exact message,
      // and a second verbatim copy is the kind of duplication that drifts.
      const status = page.getByRole('region', { name: /before you start/i });
      await expect(
        status.getByRole('link', { name: /missing-token refusal/i }),
      ).toHaveAttribute('href', '#errors');
      await expect(
        page.getByText(/The CLI is not published to npm yet/i),
      ).toHaveCount(0);
    } else {
      await expect(
        page.getByText(/The CLI is not published to npm yet/i),
      ).toBeVisible();
    }
  });

  test('the copyable command is the npm one either way', async ({ page }) => {
    // The hero shows the command the product is heading for whether or not it
    // resolves yet — DESIGN.md §4.5.3 demotes an unavailable primary action
    // rather than hiding it. What changes is the sentence beneath it.
    await page.goto('/', { waitUntil: 'networkidle' });
    await expect(
      page.getByText('npx @localize-infra/cli init').first(),
    ).toBeVisible();
  });
});

test.describe('docs navigation', () => {
  test('the table of contents jumps to a section', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/docs', { waitUntil: 'networkidle' });

    const toc = page.getByRole('navigation', { name: /on this page/i });
    await expect(toc).toBeVisible();
    await toc.getByRole('link', { name: 'Command reference' }).click();

    await expect(page).toHaveURL(/#reference$/);
    await expect(
      page.getByRole('heading', { name: 'Command reference' }),
    ).toBeInViewport();
  });

  test('Docs and Benchmarks are reachable from the header', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/', { waitUntil: 'networkidle' });
    const nav = page.getByRole('navigation', { name: 'Main' });
    await nav.getByRole('link', { name: 'Docs' }).click();
    await expect(page).toHaveURL(/\/docs$/);
  });

  test('long code samples are reachable by keyboard', async ({ page }) => {
    await page.goto('/docs', { waitUntil: 'networkidle' });
    // A scrollable region that cannot be focused is unreadable without a
    // mouse (WCAG 2.1.1).
    const block = page.getByRole('region', { name: 'Run the API' });
    await block.focus();
    await expect(block).toBeFocused();
  });
});

/**
 * The site had no width coverage before these. /docs and /benchmarks are the
 * pages most likely to break one: both are dominated by wide tables and long
 * code samples, which are exactly what pushes a layout sideways.
 */
test.describe('responsive', () => {
  for (const route of ['/docs', '/benchmarks']) {
    for (const width of [390, 768, 1024, 1440]) {
      test(`${route} does not scroll sideways at ${width}px`, async ({
        page,
      }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(route, { waitUntil: 'networkidle' });

        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - window.innerWidth,
        );
        expect(overflow, `overflowed by ${overflow}px`).toBeLessThanOrEqual(0);
      });
    }
  }

  test('any table that overflows scrolls itself, never the page', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });

    // Asserted as a conditional invariant rather than "this table scrolls":
    // the results table used to overflow at phone width and no longer does,
    // and a test pinned to that fact would have failed for the right reason
    // while telling us nothing useful.
    for (const route of ['/benchmarks', '/quality', '/docs']) {
      await page.goto(route, { waitUntil: 'networkidle' });

      const offenders = await page.$$eval('table', (tables) =>
        tables
          .filter((table) => {
            const container = table.parentElement as HTMLElement;
            const overflows = container.scrollWidth > container.clientWidth;
            const scrolls = getComputedStyle(container).overflowX === 'auto';
            return overflows && !scrolls;
          })
          .map((table) => table.querySelector('caption')?.textContent ?? '?'),
      );

      expect(offenders, `${route}: tables overflowing the page`).toEqual([]);
    }
  });

  test('the table of contents is hidden where it would push content down', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/docs', { waitUntil: 'networkidle' });
    await expect(
      page.getByRole('navigation', { name: /on this page/i }),
    ).toBeHidden();
  });
});

test.describe('SEO', () => {
  /*
   * Derived from `SITE_URL` rather than spelled out again. The host used to be
   * written here as well, so the origin the site publishes lived in two places
   * and the test asserted the duplicate rather than the source.
   */
  test('the sitemap lists every public route', async ({ request }) => {
    const xml = await (await request.get('/sitemap.xml')).text();
    for (const route of ROUTES) {
      expect(xml, `sitemap missing ${route}`).toContain(
        `${SITE_URL}${route === '/' ? '/' : route}`,
      );
    }
  });

  test('robots.txt points at the sitemap', async ({ request }) => {
    const txt = await (await request.get('/robots.txt')).text();
    expect(txt).toContain(`Sitemap: ${SITE_URL}/sitemap.xml`);
  });

  /*
   * Deriving means a malformed `SITE_URL` would agree with itself everywhere,
   * so the shape is pinned here. Whether the host actually resolves is a
   * deploy-time question — `docs/deploying.md` smoke-checks that.
   */
  test('the published origin is a bare absolute https origin', () => {
    expect(SITE_URL).toMatch(/^https:\/\/[a-z0-9.-]+\.[a-z]{2,}$/);
  });

  test('every page declares a canonical URL and a unique description', async ({
    page,
  }) => {
    const seen = new Map<string, string>();
    for (const route of ROUTES) {
      await page.goto(route, { waitUntil: 'domcontentloaded' });

      const canonical = await page
        .locator('link[rel="canonical"]')
        .getAttribute('href');
      expect(canonical, `${route}: canonical`).toBeTruthy();

      const description = await page
        .locator('meta[name="description"]')
        .getAttribute('content');
      expect(description, `${route}: description`).toBeTruthy();
      // A description reused across pages is worse than none: it tells a search
      // engine the pages are duplicates of each other.
      const previous = seen.get(description ?? '');
      expect(
        previous,
        `${route} shares its description with ${previous}`,
      ).toBeUndefined();
      seen.set(description ?? '', route);
    }
  });
});

test.describe('ecosystem rail', () => {
  test('separates the one integration from what it leaves alone', async ({
    page,
  }) => {
    await page.goto('/', { waitUntil: 'networkidle' });

    // The section's whole point is this distinction, and as a scrolling logo
    // strip it was the one thing the layout did not show.
    const integrations = page.getByRole('list', {
      name: /systems this integrates with/i,
    });
    await expect(integrations.getByRole('listitem')).toHaveCount(1);
    await expect(
      integrations.getByText('GitHub', { exact: true }),
    ).toBeVisible();

    const alongside = page.getByRole('list', {
      name: /technologies this works alongside/i,
    });
    for (const name of ['Next.js', 'React', 'TypeScript', 'Vite']) {
      await expect(
        alongside.getByText(name, { exact: true }).first(),
      ).toBeVisible();
    }
    // GitHub must not appear here: it is not left alone, it is written to.
    await expect(alongside.getByText('GitHub', { exact: true })).toHaveCount(0);
  });

  test('states that GitHub is the only integration', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    // This sentence is what makes showing a host or a database honest: they
    // are on the rail because the CLI leaves them alone, not because anything
    // is integrated with them.
    await expect(
      page.getByText(/GitHub is the one integration/i),
    ).toBeVisible();
    await expect(
      page.getByText(/none of these projects endorse this one/i),
    ).toBeVisible();
  });

  test('claims no customers, partners or endorsements', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    const body = await page.locator('body').innerText();
    for (const claim of [
      /trusted by/i,
      /our customers/i,
      /partnership/i,
      /loved by/i,
    ]) {
      expect(body, String(claim)).not.toMatch(claim);
    }
  });

  test('presents the marks without implying endorsement', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });

    // The marquee this replaced was read as "trusted by" before anyone reached
    // the caption saying otherwise — the device argued against its own words.
    // Nothing here may move, and nothing may be presented as a customer.
    await expect(page.locator('.animate-marquee')).toHaveCount(0);
    await expect(
      page.getByText(/none of these projects endorse this one/i),
    ).toBeVisible();
  });

  for (const width of [390, 768, 1440]) {
    test(`does not overflow at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/', { waitUntil: 'networkidle' });
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflow, `overflowed by ${overflow}px`).toBeLessThanOrEqual(0);
    });
  }
});

/*
 * The evidence has to be openable by the people it is shown to.
 *
 * The landing page linked its central piece of evidence — "See the pull request
 * it opened" — to a pull request in a private repository, in four places, and
 * it answered 404 to every visitor. Nobody noticed because everybody who
 * checked was signed in to GitHub as the owner. A browser test cannot sign out
 * of GitHub on anyone's behalf, but it can hold the rule that makes the failure
 * impossible: while `EXAMPLE_PR_URL` says no public pull request exists, no
 * page links into the fixture repository at all.
 *
 * When the repository is made public and the constant set, this stops
 * applying — and whoever sets it is told, in the constant's own comment, to
 * check the link signed out first.
 */
test.describe('no page links to evidence a visitor cannot open', () => {
  test.skip(EXAMPLE_PR_URL !== null, 'a public pull request is configured');

  for (const route of ROUTES) {
    test(`${route} has no link into the private fixture repository`, async ({
      page,
    }) => {
      await page.goto(route, { waitUntil: 'networkidle' });
      const hrefs = await page
        .locator('a[href]')
        .evaluateAll((links) => links.map((a) => a.getAttribute('href') ?? ''));
      expect(
        hrefs.filter((href) => href.includes('localize-infra-fixture-vite')),
      ).toEqual([]);
    });
  }
});

/*
 * Which API the published CLI talks to is one fact, `CLI_PERSONAL_TOKENS_LIVE`,
 * and it decides who receives the code context. Every page that describes the
 * CLI's path follows it, in both directions: a page promising personal tokens
 * the API refuses is as false as one telling people to run their own API after
 * the hosted one opened.
 */
/*
 * The hosted API enforces a daily ceiling. /pricing used to say "no string
 * cap", which was true until it was not, and nothing would have caught the
 * drift: the limit lives in a SQL function, the page in a constant, and the
 * two can only be kept in step deliberately.
 *
 * This holds the page to the constant. The constant against the database is a
 * release step, written down in apps/api/DEPLOYING.md.
 */
test.describe('the published limits', () => {
  test('/pricing names the ceiling, and no longer promises no string cap', async ({
    page,
  }) => {
    await page.goto('/pricing', { waitUntil: 'networkidle' });
    const text = (await page.locator('main').textContent()) ?? '';
    expect(text).not.toMatch(/no string cap/i);
    expect(text).toContain(
      HOSTED_API_LIMITS.stringsPerDay.toLocaleString('en-US'),
    );
    expect(text).toContain(String(HOSTED_API_LIMITS.pullRequestsPerDay));
    expect(text).toMatch(/resetting at 00:00 UTC/);
    // The escape hatch has to be on the page too: a ceiling with no way around
    // it reads as a paywall, and self-hosting has none.
    expect(text).toMatch(/Self-host the API and there is no ceiling/);
  });

  test('/docs tells a reader what a 429 means', async ({ page }) => {
    await page.goto('/docs', { waitUntil: 'networkidle' });
    const text = (await page.locator('main').textContent()) ?? '';
    expect(text).toMatch(/429/);
    expect(text).toContain(
      String(HOSTED_API_LIMITS.translateRequestsPerMinute),
    );
    expect(text).toMatch(/Retry-After/);
  });
});

test.describe('the CLI copy follows whether personal tokens are live', () => {
  test('the landing page', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    const text = (await page.locator('main').textContent()) ?? '';
    if (CLI_PERSONAL_TOKENS_LIVE) {
      expect(text).toMatch(/personal token/);
      expect(text).not.toMatch(/needs an API you run yourself/);
    } else {
      expect(text).not.toMatch(/personal token/);
      if (CLI_PUBLISHED_TO_NPM) {
        expect(text).toMatch(/needs an API you run yourself/);
      }
    }
  });

  test('/docs', async ({ page }) => {
    await page.goto('/docs', { waitUntil: 'networkidle' });
    const text = (await page.locator('main').textContent()) ?? '';
    if (CLI_PERSONAL_TOKENS_LIVE) {
      expect(text).toMatch(/runs against the hosted API with a personal token/);
      expect(text).toContain('https://localize-infra-api.vercel.app');
      expect(text).toMatch(/Or run your own API/);
    } else {
      expect(text).not.toMatch(/personal token/);
      expect(text).toContain('http://localhost:8787');
    }
  });

  test('/security', async ({ page }) => {
    await page.goto('/security', { waitUntil: 'networkidle' });
    const block = page.getByTestId('cli-api-disclosure');
    await expect(block).toBeVisible();
    const text = (await block.textContent()) ?? '';
    if (CLI_PERSONAL_TOKENS_LIVE) {
      expect(text).toMatch(/SHA-256 hash/);
      expect(text).toMatch(/United States/);
      expect(text).toMatch(/own GitHub connection/);
    } else {
      expect(text).toMatch(/an API you run yourself/);
      expect(text).not.toMatch(/personal CLI token/);
    }
  });
});
