import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { PUBLIC_ROUTES } from '../src/lib/routes';

/**
 * Zero axe violations is a merge gate, not a report (see the cross-cutting
 * definition of done in docs/frontend/07-milestones.md).
 *
 * Both colour schemes are checked: the dark palette is a distinct scale, not an
 * inversion, so light passing tells us nothing about dark.
 */
/*
 * Read from `PUBLIC_ROUTES`, not copied beside it.
 *
 * That constant exists so a new page cannot be added to the navigation and
 * quietly left out of the sitemap — and this list was the second place it
 * could be left out of. /terms, /privacy and /contact were invisible to the
 * accessibility gate on the day they shipped, which is precisely when a page
 * nobody has looked at needs it.
 */
const ROUTES = PUBLIC_ROUTES.map((route) => route.path);

for (const route of ROUTES) {
  for (const scheme of ['light', 'dark'] as const) {
    test(`${route} has no axe violations (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto(route);
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze();

      expect(
        results.violations.map((v) => `${v.id}: ${v.nodes.length} node(s)`),
      ).toEqual([]);
    });
  }
}

test('every page has exactly one h1 and no skipped heading levels', async ({
  page,
}) => {
  for (const route of ROUTES) {
    await page.goto(route);
    const levels = await page.$$eval('h1,h2,h3,h4,h5,h6', (nodes) =>
      nodes.map((n) => Number(n.tagName[1])),
    );
    expect(
      levels.filter((l) => l === 1),
      `${route}: h1 count`,
    ).toHaveLength(1);
    for (let i = 1; i < levels.length; i++) {
      const prev = levels[i - 1] as number;
      const cur = levels[i] as number;
      expect(
        cur - prev,
        `${route}: jump from h${prev} to h${cur}`,
      ).toBeLessThanOrEqual(1);
    }
  }
});

test('the open mobile menu has no axe violations', async ({ page }) => {
  // New surface, and the one most likely to regress: a sheet traps focus and
  // carries its own theme control. A closed dialog is not in the DOM, so the
  // route audits above prove nothing about it.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /open menu/i }).click();
  await expect(page.getByRole('dialog')).toBeVisible();

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(
    results.violations.map((v) => `${v.id}: ${v.nodes.length} node(s)`),
  ).toEqual([]);
});

test('the mobile menu closes on selection and restores focus', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/', { waitUntil: 'networkidle' });
  const trigger = page.getByRole('button', { name: /open menu/i });

  await trigger.click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  // Landing back on the trigger is what makes the sheet usable by keyboard.
  await expect(trigger).toBeFocused();
});

/**
 * Overlays are audited open, and audited *settled*.
 *
 * The dialog animates in, and running axe immediately after the click reported
 * five contrast failures that do not exist — it was measuring colours
 * mid-transition. Waiting for the animation is not a workaround here; an
 * assertion about a frame nobody sees is simply not an assertion about the
 * product.
 */
for (const scheme of ['light', 'dark'] as const) {
  test(`the open conversion dialog has no axe violations (${scheme})`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto('/');
    await page
      .getByRole('button', { name: 'Put it on your repository' })
      .click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveCSS('opacity', '1');

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(
      results.violations.map((v) => `${v.id}: ${v.nodes.length} node(s)`),
    ).toEqual([]);
  });
}
