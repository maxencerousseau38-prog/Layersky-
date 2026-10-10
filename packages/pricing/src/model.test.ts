import { describe, expect, it } from 'vitest';
import { MEASURED, PIPELINE, PRICES } from './inputs.js';
import {
  HAIKU_4_5,
  SONNET_5,
  customerCost,
  dailyCapCost,
  margin,
  maxStringsPerRequest,
  runCost,
} from './model.js';
import { PLANS, planEconomics } from './plans.js';
import { SCENARIOS } from './scenarios.js';

/**
 * These are not tests of arithmetic. They pin the claims the pricing decision
 * rests on, so a later edit to an input cannot quietly move a conclusion.
 */

describe('the output ceiling', () => {
  /*
   * These two asserted the defect — that the usable batch was 20 strings and
   * that no scenario could be onboarded at all. Both were true when this model
   * was written and neither is true now: the pipeline chunks, `effort: low`
   * collapses the thinking that was consuming the whole budget, and 250 strings
   * through the real handler returned 250 translations with none missing.
   *
   * Rewritten rather than deleted. They guard the same property from the other
   * side — work larger than one request must still be split, and a chunk must
   * still fit under the ceiling with room to spare.
   */
  it('chunks at a size that fits under the output ceiling', () => {
    const chunkOutput =
      maxStringsPerRequest() * MEASURED.outputTokensPerString.effortLow;
    expect(chunkOutput).toBeLessThan(PIPELINE.maxOutputTokensPerRequest);

    // Headroom, not a squeeze: a chunk with an unusual number of escalations
    // emits a question and alternatives for each, and that has to fit too.
    expect(chunkOutput).toBeLessThan(PIPELINE.maxOutputTokensPerRequest * 0.75);
  });

  it('splits every scenario across requests rather than sending one', () => {
    // Still true that no customer fits in a single request, including the
    // smallest. That is now a routine fan-out instead of a failed run.
    for (const shape of SCENARIOS) {
      const cost = customerCost(shape);
      expect(
        cost.requestsNeededAtOnboarding,
        `${shape.name} onboards in one request`,
      ).toBeGreaterThan(1);
      expect(
        cost.onboardingTruncates,
        `${shape.name} is still reported unanswerable`,
      ).toBe(false);
    }
  });
});

describe('runCost', () => {
  it('bills the system prompt once per request, not once per run', () => {
    const one = runCost({ stringsPerLocale: 0, locales: 1, retryRate: 0 });
    const five = runCost({ stringsPerLocale: 0, locales: 5, retryRate: 0 });

    // An empty run is not a free run: five locales cost five system prompts.
    expect(five.inputTokens).toBe(one.inputTokens * 5);
    expect(five.totalCost).toBeGreaterThan(0);
  });

  it('charges chunking in system prompts', () => {
    const oneChunk = runCost({
      stringsPerLocale: 100,
      locales: 1,
      retryRate: 0,
      chunkSize: 100,
    });
    const tenChunks = runCost({
      stringsPerLocale: 100,
      locales: 1,
      retryRate: 0,
      chunkSize: 10,
    });

    // Same strings, same output — the difference is nine extra system prompts.
    expect(tenChunks.requests).toBe(10);
    expect(tenChunks.inputTokens - oneChunk.inputTokens).toBe(
      MEASURED.systemPromptTokens * 9,
    );
    expect(tenChunks.outputTokens).toBe(oneChunk.outputTokens);
  });

  it('bills a retried attempt in full', () => {
    const once = runCost({ stringsPerLocale: 50, locales: 2, retryRate: 0 });
    const retried = runCost({ stringsPerLocale: 50, locales: 2, retryRate: 1 });
    expect(retried.totalCost).toBeCloseTo(once.totalCost * 2, 10);
  });

  it('makes escalation cost more, because it does', () => {
    const never = runCost({
      stringsPerLocale: 100,
      locales: 1,
      ambiguityRate: 0,
      retryRate: 0,
    });
    const often = runCost({
      stringsPerLocale: 100,
      locales: 1,
      ambiguityRate: 0.5,
      retryRate: 0,
    });
    expect(often.outputTokens).toBeGreaterThan(never.outputTokens);
  });

  it('prices the configured default above the measured fix', () => {
    const shape = { stringsPerLocale: 100, locales: 5, retryRate: 0 } as const;
    const asConfigured = runCost({ ...shape, outputProfile: 'asConfigured' });
    const effortLow = runCost({ ...shape, outputProfile: 'effortLow' });

    // 159 vs 56 measured output tokens per string.
    expect(asConfigured.totalCost).toBeGreaterThan(effortLow.totalCost);
  });
});

describe('the levers, priced', () => {
  const normal = SCENARIOS.find((s) => s.name === 'normal');
  if (!normal) throw new Error('the `normal` scenario is missing');

  it('prompt caching saves real money and is not switched on', () => {
    expect(PIPELINE.promptCaching).toBe(false);
    const off = customerCost(normal).steadyStateMonthlyCost;
    const on = customerCost({
      ...normal,
      promptCaching: true,
    }).steadyStateMonthlyCost;
    expect(on).toBeLessThan(off);
  });

  it('Haiku is cheaper on both sides of the bill', () => {
    expect(HAIKU_4_5.input).toBeLessThan(SONNET_5.input);
    expect(HAIKU_4_5.output).toBeLessThan(SONNET_5.output);
    const cheaper = customerCost({ ...normal, rate: HAIKU_4_5 });
    const current = customerCost(normal);
    expect(cheaper.steadyStateMonthlyCost).toBeLessThan(
      current.steadyStateMonthlyCost,
    );
  });

  it('prices at the permanent standard rate, with no expiring rate modelled', () => {
    /*
     * This used to assert that the introductory rate flattered every figure
     * and expired on 2026-08-31. Anthropic made $2/$10 the standard price and
     * cancelled the rise to $3/$15, so there is no second Sonnet 5 rate left
     * to compare against and no date on which these figures stop being true.
     *
     * What still needs guarding is the default: every function here takes
     * `rate` with a default, so a wrong default would silently reprice the
     * whole model.
     */
    expect(SONNET_5).toEqual({ input: 2.0, output: 10.0 });
    expect(customerCost(normal).steadyStateMonthlyCost).toBe(
      customerCost({ ...normal, rate: SONNET_5 }).steadyStateMonthlyCost,
    );
    // Haiku remains the cheaper option, so the lever it represents is real.
    expect(HAIKU_4_5.input).toBeLessThan(SONNET_5.input);
  });
});

describe('what a subscription has to survive', () => {
  it('costs more in month one than in any month after it', () => {
    for (const shape of SCENARIOS) {
      const cost = customerCost(shape);
      // The inverse of the usual SaaS shape, and the reason annual billing is
      // a recommendation rather than a preference.
      expect(cost.firstMonthCost).toBeGreaterThan(cost.steadyStateMonthlyCost);
    }
  });

  it('finds the usage shape that loses money at every candidate price', () => {
    const worst = SCENARIOS.find((s) => s.name === 'worst-realistic');
    if (!worst) throw new Error('the `worst-realistic` scenario is missing');
    const cost = customerCost(worst);

    for (const price of [19, 99, 399]) {
      expect(
        margin(price, cost.firstMonthCost).grossMarginDollars,
        `$${price} survives the worst realistic customer`,
      ).toBeLessThan(0);
    }
  });

  it('a daily cap bounds the unbounded case', () => {
    const uncapped = runCost({
      stringsPerLocale: 1_000_000,
      locales: 10,
      retryRate: 0,
    });
    const capped = dailyCapCost(2000, 10);
    expect(capped).toBeLessThan(uncapped.totalCost);
  });
});

describe('prices are quoted per million tokens', () => {
  it('matches the published rates the model was built against', () => {
    // Pinned so a silent edit to a rate shows up as a failing test rather than
    // as a quietly different recommendation.
    expect(PRICES.sonnet5).toEqual({ input: 2.0, output: 10.0 });
    expect(PRICES.haiku45).toEqual({ input: 1.0, output: 5.0 });
  });
});

/**
 * The proposed plans, held to the economics they were derived from.
 *
 * These assertions are what stops a plan from being "adjusted" in a hurry to
 * look more generous than it can afford.
 */
describe('the proposed plans', () => {
  it('clears 70% gross margin even if every allowed pair is used', () => {
    for (const plan of PLANS) {
      if (plan.monthlyPrice === 0) continue;
      const e = planEconomics(plan);
      expect(
        e.grossMarginPercentAtCap,
        `${plan.name} at its cap`,
      ).toBeGreaterThanOrEqual(70);
    }
  });

  it('keeps the free plan under a dollar a month', () => {
    const free = PLANS.find((p) => p.name === 'Free');
    if (!free) throw new Error('the Free plan is missing');
    // Free is a marketing cost and has to stay one. Most signups will be this
    // and will never become anything else.
    expect(planEconomics(free).worstMonthlyCogs).toBeLessThan(1);
  });

  it('lets the monthly allowance bind, not the daily ceiling', () => {
    // A daily ceiling that could not be exceeded over a month would be the
    // only limit in force, which would mean it was set too high.
    for (const plan of PLANS) {
      expect(planEconomics(plan).monthlyCapBinds, plan.name).toBe(true);
    }
  });

  it('prices each initial import as a one-off the plan can carry', () => {
    // The import is where the multiplicative cost lands. Annual prepay is what
    // pays for it, so each import must come in under the annual price.
    for (const plan of PLANS) {
      if (plan.monthlyPrice === 0) continue;
      expect(
        planEconomics(plan).initialImportCogs,
        `${plan.name} import against its annual price`,
      ).toBeLessThan(plan.annualPrice);
    }
  });

  it('onboards the typical customer on the cheapest paid plan', () => {
    const normal = SCENARIOS.find((s) => s.name === 'normal');
    const starter = PLANS.find((p) => p.name === 'Starter');
    if (!normal || !starter) throw new Error('missing fixture');

    const importPairs = normal.projectStrings * normal.locales;
    expect(importPairs).toBeLessThanOrEqual(starter.initialImportPairs);
    expect(normal.locales).toBeLessThanOrEqual(
      starter.locales ?? Number.POSITIVE_INFINITY,
    );
  });

  it('pushes the worst realistic customer above every plan, on purpose', () => {
    const worst = SCENARIOS.find((s) => s.name === 'worst-realistic');
    if (!worst) throw new Error('missing fixture');
    const importPairs = worst.projectStrings * worst.locales * worst.projects;

    // 3,000,000 pairs. No plan admits this, which is the point: it is the
    // signup that would otherwise cost more than thirty typical customers pay.
    for (const plan of PLANS) {
      expect(importPairs, plan.name).toBeGreaterThan(plan.initialImportPairs);
    }
  });
});
