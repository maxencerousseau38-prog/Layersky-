import { expect, test } from '@playwright/test';
import { PUBLIC_ROUTES } from '../src/lib/routes';

/**
 * Responsive tiers (DESIGN.md §3.4, §4.5, §12).
 *
 * Each of these drifted silently and was invisible to every other check: the
 * hero title jumped to its largest step at 640 when the type table puts that
 * step at 1024, and the artifact's negative inline-end margin started at 1024,
 * where the container is already the full viewport — so 40px of the card was
 * pushed off-screen and `overflow-hidden` clipped it. Neither produced document
 * overflow, so the overflow sweep stayed green through both.
 */

/*
 * 640 is here because the header overflowed by 28px at exactly that width and
 * at no other. It is the `sm` boundary, where the bar switched from the sheet
 * to its full desktop row in one step; this list went 390 → 768 and stepped
 * over the only viewport that failed.
 *
 * A breakpoint is where a layout changes, which makes it the width most likely
 * to be wrong and the one least likely to be sampled. Both boundaries the site
 * actually switches on are now in the list.
 */
const WIDTHS = [390, 640, 768, 1024, 1280, 1440, 1920];

test('the hero title uses the step its tier calls for', async ({ page }) => {
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/');
    const size = await page
      .locator('h1')
      .evaluate((el) => Number.parseFloat(getComputedStyle(el).fontSize));
    // display-xl below lg, display-2xl at and above it.
    expect(size, `hero title at ${width}px`).toBe(width >= 1024 ? 68 : 52);
  }
});

test('the hero artifact never bleeds off the screen', async ({ page }) => {
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/');
    const right = await page
      .locator('figure')
      .first()
      .evaluate((el) => el.getBoundingClientRect().right);
    expect(right, `artifact right edge at ${width}px`).toBeLessThanOrEqual(
      width,
    );
  }
});

test('no route overflows horizontally at any tier', async ({ page }) => {
  // Read from `PUBLIC_ROUTES` rather than copied beside it: a page added to
  // the navigation and not to this array is a page nobody sweeps, and the
  // three legal pages were exactly that on the day they shipped.
  const routes = PUBLIC_ROUTES.map((route) => route.path);
  const bad: string[] = [];
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of routes) {
      await page.goto(route);
      const over = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      if (over > 0) bad.push(`${route} @${width} +${over}px`);
    }
  }
  expect(bad).toEqual([]);
});
