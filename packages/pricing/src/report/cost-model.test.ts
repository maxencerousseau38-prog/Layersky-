import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { REPORT } from './build.js';

/**
 * The committed report must be what the generator produces.
 *
 * The same guard `packages/eval` puts on the benchmarks the marketing site
 * publishes, and it matters more here: these figures decide a price. Without
 * it, a number could be edited into cost-model.json — or into
 * docs/product/09-unit-economics.md, which quotes it — and nothing would
 * notice. Hand-written figures with no provenance are exactly what
 * `08-critique.md` §C3 refused to let a price be built on.
 */
describe('cost-model.json', () => {
  it('matches its generator', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const committed = JSON.parse(
      readFileSync(join(here, 'cost-model.json'), 'utf8'),
    );

    expect(committed).toEqual(JSON.parse(JSON.stringify(REPORT)));
  });

  it('records the provenance of every input it used', () => {
    // The tiering is the point of this model. A report that lost it would be
    // the rough arithmetic it replaced.
    expect(REPORT.inputs).toHaveProperty('MEASURED');
    expect(REPORT.inputs).toHaveProperty('PRICES');
    expect(REPORT.inputs).toHaveProperty('ASSUMPTIONS');
  });

  it('is priced at the permanent standard rate, with no expiring rate left', () => {
    /*
     * This asserted $3.00 and an expiry of 2026-08-31. Anthropic made the
     * $2/$10 introductory rate standard and cancelled the scheduled rise, so
     * both halves became false. The `not.toHaveProperty` pair is the load
     * bearing part: it fails if an `introductory` rate is reintroduced into
     * the report without a source, which is how the stale one survived.
     */
    expect(REPORT.rates.standard).toEqual({ input: 2.0, output: 10.0 });
    expect(REPORT.rates).not.toHaveProperty('introductory');
    expect(REPORT.rates).not.toHaveProperty('introductoryUntil');
  });

  it('derives the production observation from measured tokens and the published rate', () => {
    /*
     * The one figure in this report taken from production rather than a
     * harness. Pinned as arithmetic, not as a literal: if either the token
     * counts or the rate change, this fails rather than quietly disagreeing
     * with the document that quotes it.
     */
    const o = REPORT.productionObservation;
    expect(o.requests).toBe(6);
    expect(o.inputTokens).toBe(9847);
    expect(o.outputTokens).toBe(757);
    expect(o.derivedCostUsd).toBeCloseTo(
      (9847 * REPORT.rates.standard.input +
        757 * REPORT.rates.standard.output) /
        1e6,
      9,
    );
    expect(o.derivedCostUsd).toBeCloseTo(0.027264, 9);

    // The distinction the model is required to keep: consumption is measured,
    // the dollar figure is derived, and no invoice has been compared to it.
    expect(o.reconciledAgainstInvoice).toBe(false);
    // Six mixed locales, two refusals, no per-locale breakdown.
    expect(o.establishesCostPerPair).toBe(false);
    expect(o.unitsCharged).toBe(6);
    expect(o.unitsApplied).toBe(4);
  });
});
