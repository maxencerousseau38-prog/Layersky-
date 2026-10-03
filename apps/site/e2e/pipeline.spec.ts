import { expect, test } from '@playwright/test';

/**
 * The landing page must explain the product it sells.
 *
 * This file used to assert the opposite of what it now asserts, and that is
 * the point of the comment. It read `PIPELINE_STAGES` and required the page
 * to name all five legacy stages — detect, extract, translate, escalate,
 * pull request — under the heading "One command, five stages". That guard was
 * correct for as long as the page sold that pipeline. The page now sells the
 * check, and a guard pinning the old copy would have made replacing it look
 * like a regression.
 *
 * `PIPELINE_STAGES` is untouched, and `apps/web` still tests it: a run on
 * `/runs/[id]` really does have five stages. What moved is which product the
 * marketing page leads with.
 */

/** The four finding kinds, named exactly as `packages/eval/src/audit` emits them. */
const FINDING_KINDS = [
  'missing-translation',
  'placeholder-mismatch',
  'icu-invalid',
  'missing-source',
];

function findings(page: import('@playwright/test').Page) {
  return page.getByRole('table', {
    name: 'What the check finds and what it fixes',
  });
}

test('the landing page names every finding the check can report', async ({
  page,
}) => {
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: /names four problems and fixes one/i }),
  ).toBeVisible();

  const text = ((await findings(page).textContent()) ?? '').toLowerCase();
  for (const kind of FINDING_KINDS) {
    expect(text, `the landing page never mentions "${kind}"`).toContain(kind);
  }
});

/*
 * The one claim on this page that a reader will hold the product to: three of
 * the four findings are never corrected automatically. If a future change made
 * the table say "Yes" four times, the product would be claiming it rewrites
 * translations somebody wrote by hand.
 */
test('exactly one finding is corrected automatically', async ({ page }) => {
  await page.goto('/');
  const rows = findings(page).locator('tbody tr');
  await expect(rows).toHaveCount(FINDING_KINDS.length);

  const answers = await rows.evaluateAll((trs) =>
    trs.map((tr) => tr.querySelectorAll('td')[2]?.textContent?.trim() ?? ''),
  );
  expect(answers.filter((a) => a.startsWith('Yes'))).toHaveLength(1);
  expect(answers.filter((a) => a.startsWith('No'))).toHaveLength(3);
});

/*
 * The hero's evidence has to be openable. The old band showed a run in a
 * *private* repository and the page had to admit the pull request could not
 * be linked; this replaced it with a public one, and the whole reason that is
 * an improvement is that the links work.
 */
test('the hero links the pull request its evidence comes from', async ({
  page,
}) => {
  await page.goto('/');
  const band = page.locator(
    '[aria-label="A check Layersky posted on a real pull request"]',
  );
  const links = band.getByRole('link');
  await expect(links.first()).toBeVisible();

  for (const href of await links.evaluateAll((as) =>
    as.map((a) => (a as HTMLAnchorElement).href),
  )) {
    expect(href).toMatch(
      /^https:\/\/github\.com\/maxencerousseau38-prog\/localize-infra-fixture-i18next\/pull\/\d+$/,
    );
  }
});

/**
 * The State Rule is the design system's signature (DESIGN.md §1.4, §5.2) and is
 * 3px. The hero drew its own at 2px for as long as it existed — invisible in
 * review, because 2px and 3px look identical until measured side by side.
 *
 * The hero no longer carries a State Rule at all: its panel became a source
 * file and a diff, and a hand-rolled rule there would have been the same bug in
 * a new place. So this now sweeps every page that does use the rule, and it
 * catches a local copy wherever one appears rather than only in the hero.
 *
 * The band is the whole point. Anything drawing a leading edge thicker than a
 * hairline is trying to be the signature, so it has to measure 3px exactly;
 * genuine 1px hairlines are ignored, and a 2px copy cannot hide.
 */
const RULE_PAGES = ['/benchmarks', '/docs', '/pricing', '/quality'];

for (const path of RULE_PAGES) {
  test(`${path} draws the 3px State Rule, not a local copy`, async ({
    page,
  }) => {
    await page.goto(path);

    const widths = await page.evaluate(() =>
      [...document.querySelectorAll('*')]
        .map((el) => getComputedStyle(el).borderInlineStartWidth)
        .filter((w) => {
          const px = Number.parseFloat(w);
          return px > 1 && px < 6;
        }),
    );

    // Non-vacuous: each of these pages renders at least one State Rule, so an
    // empty result means the sweep stopped seeing them, not that all is well.
    expect(widths.length, `leading rules found on ${path}`).toBeGreaterThan(0);
    for (const width of widths) expect(width).toBe('3px');
  });
}
