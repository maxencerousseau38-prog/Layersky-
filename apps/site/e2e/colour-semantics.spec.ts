import { expect, test } from '@playwright/test';

/**
 * Iris means one thing (DESIGN.md §1.4, §6.1): your judgement is required.
 *
 * It is not a brand accent, not chrome, and explicitly not roadmap or maturity
 * state (§6.3). That rule was already enforced once, on the landing page's
 * status board — and by the time this test was written the same leak had
 * reappeared on five pages, spending the ambiguity colour on "Not yet
 * measured", "Not measured", "Pre-alpha", "Not started" and every roadmap
 * item under construction.
 *
 * The marketing site never asks the reader to resolve an ambiguity, so nothing
 * on it should be painted with the ambiguity colour. That makes the rule
 * checkable as an absolute here, which is the only reason it holds.
 */

const PAGES = [
  '/',
  '/docs',
  '/benchmarks',
  '/quality',
  '/security',
  '/pricing',
  '/roadmap',
];

for (const path of PAGES) {
  test(`${path} spends no Iris on chrome or maturity state`, async ({
    page,
  }) => {
    await page.goto(path);

    const ambiguous = await page.evaluate(() => {
      /*
       * All three ambiguity tokens, not just the base one. The first version of
       * this test checked `--state-ambiguous` alone and passed a mutation that
       * restored an Iris badge — because `Badge` paints with the `-bg` and
       * `-text` variants and never touches the base token. A guard that cannot
       * fail is worse than no guard, so the mutation check is what defines this
       * list.
       */
      const names = [
        '--state-ambiguous',
        '--state-ambiguous-bg',
        '--state-ambiguous-text',
      ];
      const root = getComputedStyle(document.documentElement);
      const probe = document.createElement('span');
      document.body.append(probe);

      const targets = new Set(
        names.map((name) => {
          const value = root.getPropertyValue(name).trim();
          if (!value) throw new Error(`${name} is not defined`);
          // Resolve to the rgb() the browser actually paints, so the comparison
          // survives the token being written in any colour syntax.
          probe.style.color = value;
          return getComputedStyle(probe).color;
        }),
      );
      probe.remove();

      return [...document.querySelectorAll('*')]
        .filter((el) => {
          const s = getComputedStyle(el);
          return [
            s.color,
            s.backgroundColor,
            s.borderInlineStartColor,
            s.borderTopColor,
            s.borderBottomColor,
            s.borderInlineEndColor,
            s.outlineColor,
          ].some((painted) => targets.has(painted));
        })
        .map((el) => `${el.tagName}.${String(el.className).slice(0, 60)}`);
    });

    expect(
      ambiguous,
      `Iris is reserved for "a human must decide"; these elements use it on a page that asks nothing of the reader`,
    ).toEqual([]);
  });
}

/**
 * Jade means something happened (DESIGN.md §6.1): verified, current, merged,
 * passing. Unlike Iris it cannot be checked as an absolute here, because the
 * site paints it in six honest places — the run artifact, "Working today",
 * the WORKING rows on the status board, measured results on /benchmarks and
 * /quality, Shipped on /roadmap, and the free-public-repositories rule on
 * /pricing. Every one of those reports a real outcome.
 *
 * So the rule has to be pinned where it was actually broken. The landing page
 * draws the five pipeline stages twice: once in the hero as a run that really
 * executed, and once in "How it works" as a diagram of what the stages are.
 * The diagram had a jade node on Detect and neutral nodes on the other four —
 * no run, but a colour saying stage one passed, sitting a screen below an
 * artifact that had just taught the reader jade means "this stage finished".
 * It read as a pipeline that stops after Detect.
 *
 * The Iris sweep above could never have caught it, and nothing else did.
 *
 * Both halves below are load-bearing. The first forbids state on the diagram;
 * the second requires it on the real run, so the first can never be satisfied
 * by draining the colour out of the surface that has genuinely earned it.
 * All four families are checked, not just jade — the same mistake reads
 * identically in amber or crimson.
 */
const STATE_FAMILIES: Record<string, string[]> = {
  confident: [
    '--state-confident',
    '--state-confident-bg',
    '--state-confident-text',
  ],
  degraded: [
    '--state-degraded',
    '--state-degraded-bg',
    '--state-degraded-text',
  ],
  failed: ['--state-failed', '--state-failed-bg', '--state-failed-text'],
  ambiguous: [
    '--state-ambiguous',
    '--state-ambiguous-bg',
    '--state-ambiguous-text',
  ],
};

/** Every state colour painted anywhere inside `selector`, by family. */
async function statePaintedWithin(
  page: import('@playwright/test').Page,
  selector: string,
) {
  return page.evaluate(
    ({ sel, families }) => {
      const root = getComputedStyle(document.documentElement);
      const probe = document.createElement('span');
      document.body.append(probe);

      // Resolve every token to the rgb() the browser actually paints, so the
      // comparison survives a token being rewritten in any colour syntax.
      const byColour = new Map<string, string>();
      for (const [family, names] of Object.entries(families)) {
        for (const name of names) {
          const value = root.getPropertyValue(name).trim();
          if (!value) throw new Error(`${name} is not defined`);
          probe.style.color = value;
          byColour.set(getComputedStyle(probe).color, family);
        }
      }
      probe.remove();

      const scope = document.querySelector(sel);
      if (!scope) throw new Error(`nothing matches ${sel}`);

      const found: string[] = [];
      for (const el of [scope, ...scope.querySelectorAll('*')]) {
        const s = getComputedStyle(el);
        for (const painted of [
          s.color,
          s.backgroundColor,
          s.borderInlineStartColor,
          s.borderTopColor,
          s.borderBottomColor,
          s.borderInlineEndColor,
          s.outlineColor,
        ]) {
          const family = byColour.get(painted);
          if (family) {
            found.push(`${family} on ${el.tagName}`);
            break;
          }
        }
      }
      return found;
    },
    { sel: selector, families: STATE_FAMILIES },
  );
}

/*
 * Both selectors moved when the landing page stopped selling the legacy
 * pipeline. The rail of five stages is gone from this page — it still exists
 * in the hosted app, where a run really has stages — and the two things worth
 * checking here are now a table that must claim nothing and a check artifact
 * that must claim exactly one thing.
 */
const FINDINGS_TABLE =
  'table[aria-label="What the check finds and what it fixes"]';
const REAL_CHECK =
  '[aria-label="A check Layersky posted on a real pull request"]';

test('the findings table claims no state, because it describes behaviour', async ({
  page,
}) => {
  await page.goto('/');

  // Non-vacuous: four finding kinds, one row each. An empty table would make
  // the assertion below pass by having nothing to inspect.
  await expect(page.locator(`${FINDINGS_TABLE} tbody tr`)).toHaveCount(4);

  expect(
    await statePaintedWithin(page, FINDINGS_TABLE),
    'the table explains which findings get corrected; painting "No" amber or crimson would report a degraded state where the answer is the behaviour being promised',
  ).toEqual([]);
});

test('the check artifact does claim state, because a real check passed', async ({
  page,
}) => {
  await page.goto('/');

  const painted = await statePaintedWithin(page, REAL_CHECK);

  expect(
    painted.filter((entry) => entry.startsWith('confident')).length,
    'the band shows a check that went from six problems to none; the green half is a state something really reached, and if it stops being painted the test above has been satisfied by removing colour rather than by keeping it honest',
  ).toBeGreaterThan(0);
});

/** Every element on the page painting one state family. */
async function familyOnPage(
  page: import('@playwright/test').Page,
  path: string,
  family: string,
) {
  await page.goto(path);
  const painted = await statePaintedWithin(page, 'body');
  return painted.filter((entry) => entry.startsWith(family));
}

/**
 * Crimson means failed, destructive, irreversible (§6.1).
 *
 * A marketing site performs no destructive operation and nothing on it can
 * fail, so the only honest red is *quoted output* — the four refusal messages
 * on /docs, which are the CLI's real stderr text: no supported framework, a
 * locale file it will not overwrite, a missing API token, an --open-pr call
 * without owner and repo. That makes the rule an absolute everywhere else,
 * which is the same reason the Iris sweep above can be one.
 *
 * The regression this exists to catch is not subtle and is easy to commit:
 * a red "unsupported" chip, a red "no" column in a comparison table, a
 * destructive-looking badge on a page where nothing is destructive.
 */
const NO_CRIMSON = [
  '/',
  '/benchmarks',
  '/quality',
  '/security',
  '/pricing',
  '/roadmap',
];

for (const path of NO_CRIMSON) {
  test(`${path} spends no crimson, because nothing here fails`, async ({
    page,
  }) => {
    expect(
      await familyOnPage(page, path, 'failed'),
      'crimson marks a failure, a destructive action, or something irreversible; this page has none of the three',
    ).toEqual([]);
  });
}

test('/docs does mark the real refusals in crimson', async ({ page }) => {
  // The counterweight. Without it every test above is satisfied by deleting
  // the refusal examples, which would take the site's only honest red with it.
  expect(
    await familyOnPage(page, '/docs', 'failed'),
    'the "When it refuses" examples quote the CLI\'s real error output; if they stop being marked as failures the absolutes above have been won by removing evidence',
  ).not.toEqual([]);
});

/**
 * Amber means partial, stale, behind, missing (§6.1).
 *
 * Unlike crimson this is not absent site-wide, and the three places it appears
 * are load-bearing admissions rather than decoration: "Partly working" on the
 * commitment whose resolution queue no real run has used, the extraction gap
 * on /docs, and the data-residency gap on /security. Each names something
 * that is genuinely incomplete today.
 *
 * The four pages below carry none, and the rule that keeps them clean is §6.3:
 * colour is forbidden on roadmap and maturity state. /roadmap is the whole
 * hazard in one page — every row on it is a maturity state, and painting them
 * amber is the most tempting change anyone will ever make to this site.
 * /benchmarks and /quality publish measured numbers, where a colour would be
 * read as a verdict the harness has not issued.
 *
 * If a future measurement genuinely warrants amber, this fails and the author
 * decides deliberately. That is the point of it, not a defect in it.
 */
const NO_AMBER = ['/benchmarks', '/quality', '/pricing', '/roadmap'];

for (const path of NO_AMBER) {
  test(`${path} spends no amber on maturity or measurement`, async ({
    page,
  }) => {
    expect(
      await familyOnPage(page, path, 'degraded'),
      'amber marks something partial, stale or missing; on this page it would be painting a roadmap position or a measured result, which §6.3 forbids',
    ).toEqual([]);
  });
}

for (const path of ['/', '/security']) {
  test(`${path} does mark what is genuinely partial in amber`, async ({
    page,
  }) => {
    // The counterweight again: these two pages admit something incomplete —
    // a half-built commitment and the EU residency gap — and the absolutes
    // above must not be winnable by quietly dropping the admission.
    expect(
      await familyOnPage(page, path, 'degraded'),
      'this page states something that is only partly true today; losing the mark would make the page read as though it were wholly true',
    ).not.toEqual([]);
  });
}
