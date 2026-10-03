import { expect, test } from '@playwright/test';
import { APP_URL } from '../src/lib/constants';

/**
 * Interaction feedback: the press, the pointer it is meant for, and the chrome
 * that responds to scrolling.
 *
 * Hover was doing all of the work here. On a touch device hover either does not
 * exist or latches after a tap, so every control whose only feedback was
 * `hover:` answered a finger with nothing — including the copy command, which
 * the component itself calls the most important interactive element on the
 * public site and whose "Copied" swap waits on an async clipboard write.
 */

/**
 * Resolves what a surface paints on hover and what it paints while pressed.
 *
 * Read out of the cascade rather than produced by driving the pointer. Two
 * earlier versions of this helper measured the wrong thing: a real press
 * compared two frames of a running `transition-colors` and passed on the
 * interpolation alone, and `CSS.forcePseudoState` is a DevTools affordance that
 * `getComputedStyle` observes only sometimes — under parallel load it reported
 * missing pressed states on surfaces that plainly have them.
 *
 * So this reads the generated rules directly. It answers the two questions that
 * actually matter, with no timing in either: does the surface declare a pressed
 * background distinct from its hover background, and does that declaration come
 * later in the sheet, so it wins when both states are true at once.
 */
async function hoverAndPressRules(
  page: import('@playwright/test').Page,
  selector: string,
) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) throw new Error(`no element for ${sel}`);

    const classes = [...el.classList];
    const hoverClass = classes.find((c) => c.startsWith('hover:bg-'));
    const activeClass = classes.find((c) => c.startsWith('active:bg-'));

    /*
     * The declaration is read off the rule rather than off a probe element:
     * `active:bg-primary/85` is generated, but the bare `bg-primary/85` it
     * would be probed with is not, so a probe reports "transparent" for both
     * states and the comparison passes while proving nothing.
     */
    type Match = { background: string; order: number };

    const ruleFor = (className: string, pseudo: string): Match | null => {
      const wanted = `.${CSS.escape(className)}:${pseudo}`;
      let order = 0;
      let found: Match | null = null;

      // Descends into every grouping rule, not just `@media`. Tailwind v4 emits
      // its utilities inside `@layer`, so a walker that only knew about media
      // queries never reached a single one of them and reported "no rule" for
      // states that are plainly in the stylesheet.
      // `CSSStyleRule` is tested first because CSS nesting made it a subclass of
      // `CSSGroupingRule` — checking the group first swallows every style rule.
      const walk = (rules: CSSRuleList) => {
        for (const rule of rules) {
          if (rule instanceof CSSStyleRule) {
            order += 1;
            // Last one wins: Tailwind emits a plain fallback followed by a
            // `color-mix` refinement for the alpha-modified utilities.
            if (rule.selectorText === wanted) {
              found = { background: rule.style.backgroundColor, order };
            }
            walk(rule.cssRules);
          } else if (rule instanceof CSSGroupingRule) {
            walk(rule.cssRules);
          }
        }
      };

      for (const sheet of document.styleSheets) {
        try {
          walk(sheet.cssRules);
        } catch {
          // Cross-origin sheet; nothing of ours lives there.
        }
      }
      return found;
    };

    return {
      hoverClass: hoverClass ?? null,
      activeClass: activeClass ?? null,
      hover: hoverClass ? ruleFor(hoverClass, 'hover') : null,
      active: activeClass ? ruleFor(activeClass, 'active') : null,
    };
  }, selector);
}

/*
 * Every surface-backed target a visitor can press on the landing page. Inline
 * text links are deliberately absent: they keep the browser's native tap
 * highlight, and giving them a bespoke pressed treatment would be new visual
 * language rather than the step Button already defines.
 */
/*
 * The two filled surfaces in the hero, and the copy command further down.
 *
 * This list used to branch on `EXAMPLE_PR_URL`, because the hero's filled
 * action was either a pull request a visitor could open or, failing that, the
 * docs. Both are stale. The filled action is now the hosted app, and the pull
 * request beside it is real and public rather than conditional — the fixture
 * the evidence comes from is no longer private.
 */
const PRESSABLE: { name: string; selector: string }[] = [
  { name: 'copy command', selector: 'button[aria-label^="Copy command"]' },
  {
    name: 'primary call to action',
    selector: `main a[href="${APP_URL}"]`,
  },
  { name: 'hero evidence link', selector: 'main a[href*="/pull/"]' },
];

/** Asserts a surface declares a pressed state that differs from, and beats, hover. */
function expectPressBeatsHover(
  result: Awaited<ReturnType<typeof hoverAndPressRules>>,
  name: string,
) {
  expect(result.activeClass, `${name} declares a pressed background`).not.toBe(
    null,
  );
  expect(result.active, `${name} has a generated :active rule`).not.toBe(null);

  if (!result.hover || !result.active) return;

  expect(
    result.active.background,
    `${name} presses to a different colour than it hovers to`,
  ).not.toBe(result.hover.background);

  // Same specificity, so the later rule is the one that paints while a pointer
  // is both over the surface and held down.
  expect(
    result.active.order,
    `${name} pressed rule comes after its hover rule`,
  ).toBeGreaterThan(result.hover.order);
}

for (const { name, selector } of PRESSABLE) {
  test(`${name} changes on press, not only on hover`, async ({ page }) => {
    await page.goto('/');
    expectPressBeatsHover(await hoverAndPressRules(page, selector), name);
  });
}

test('the mobile menu rows respond to a press', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto('/');

  await page.getByRole('button', { name: 'Open menu' }).click();
  await expect(page.locator('[role="dialog"] nav a').first()).toBeVisible();

  // Scoped to the sheet: the desktop nav carries the same landmark label and
  // is merely hidden at this width, so an unscoped lookup finds it first.
  expectPressBeatsHover(
    await hoverAndPressRules(page, '[role="dialog"] nav a'),
    'mobile menu row',
  );
});

/**
 * Tailwind v4 compiles `hover:` to `@media (hover: hover)` on its own. This
 * asserts that guarantee rather than assuming it: the entire reason the pressed
 * states above are scoped the way they are is that hover never reaches a touch
 * device, and if a raw `:hover` rule were ever hand-written into a stylesheet it
 * would latch after a tap and silently undo that reasoning.
 */
test('no hover styling applies to pointers that cannot hover', async ({
  page,
}) => {
  await page.goto('/');

  const ungated = await page.evaluate(() => {
    const found: string[] = [];

    let seen = 0;

    // Style rules first: CSS nesting made `CSSStyleRule` a `CSSGroupingRule`,
    // and testing the group first skips every one of them — which is how an
    // earlier version of this test walked the whole sheet, visited nothing
    // inside `@layer`, and passed on an empty result.
    const walk = (rules: CSSRuleList, hoverGated: boolean) => {
      for (const rule of rules) {
        if (rule instanceof CSSStyleRule) {
          // `:hover` inside a `:not()` is an exclusion, not a hover treatment.
          const selector = rule.selectorText.replace(/:not\([^)]*\)/g, '');
          if (selector.includes(':hover')) {
            seen += 1;
            if (!hoverGated) found.push(selector);
          }
          walk(rule.cssRules, hoverGated);
        } else if (rule instanceof CSSGroupingRule) {
          const gated =
            hoverGated ||
            (rule instanceof CSSMediaRule &&
              /hover\s*:\s*hover/.test(rule.conditionText));
          walk(rule.cssRules, gated);
        }
      }
    };

    for (const sheet of document.styleSheets) {
      try {
        walk(sheet.cssRules, false);
      } catch {
        // Cross-origin sheet; nothing of ours lives there.
      }
    }
    return { found, seen };
  });

  // Non-vacuous: the page has hover treatments, so an empty `seen` would mean
  // the walk found nothing rather than that everything is correctly gated.
  expect(ungated.seen, 'hover rules discovered').toBeGreaterThan(0);
  expect(ungated.found).toEqual([]);
});

/**
 * The bar earns its separation. At rest there is nothing beneath it, so a
 * divider and a frosted backdrop are decoration; both were painted
 * unconditionally before this.
 */
test.describe('sticky header chrome', () => {
  test('carries no divider or backdrop at rest', async ({ page }) => {
    await page.goto('/');

    const header = page.locator('header');
    const { borderColor, backdrop } = await header.evaluate((el) => {
      const s = getComputedStyle(el);
      return {
        borderColor: s.borderBottomColor,
        backdrop: s.getPropertyValue('backdrop-filter'),
      };
    });

    expect(borderColor).toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
    expect(backdrop === 'none' || backdrop === '').toBe(true);
  });

  test('materialises once content scrolls underneath', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => window.scrollTo(0, 400));
    await expect(page.locator('header')).toHaveAttribute(
      'data-scrolled',
      'true',
    );

    const { borderColor, backdrop } = await page
      .locator('header')
      .evaluate((el) => {
        const s = getComputedStyle(el);
        return {
          borderColor: s.borderBottomColor,
          backdrop: s.getPropertyValue('backdrop-filter'),
        };
      });

    expect(borderColor).not.toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
    expect(backdrop).toContain('blur');
  });

  test('is already materialised when the page loads mid-document', async ({
    page,
  }) => {
    // A restored position or an anchor load never fires a scroll event, so the
    // state has to be read on mount rather than only on scroll.
    await page.goto('/#main');
    await page.evaluate(() => window.scrollTo(0, 600));
    await page.reload();

    await expect(page.locator('header')).toHaveAttribute(
      'data-scrolled',
      'true',
    );
  });

  /*
   * `emulateMedia` has no option for this preference, so it goes through CDP.
   * The first assertion is the important one: an earlier version of this test
   * only checked for the absence of blur, and passed against a broken build
   * where the stylesheet had failed to load and *nothing* was blurred.
   */
  test('drops translucency when the user asks for reduced transparency', async ({
    page,
    browserName,
  }) => {
    test.skip(
      browserName !== 'chromium',
      'CDP media emulation is Chromium-only',
    );

    await page.goto('/');
    await page.evaluate(() => window.scrollTo(0, 400));

    const backdrop = () =>
      page
        .locator('header')
        .evaluate((el) =>
          getComputedStyle(el).getPropertyValue('backdrop-filter'),
        );

    expect(
      await backdrop(),
      'blur is present before the preference is set',
    ).toContain('blur');

    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }],
    });

    await expect.poll(async () => await backdrop()).toMatch(/^(none)?$/);
  });
});
