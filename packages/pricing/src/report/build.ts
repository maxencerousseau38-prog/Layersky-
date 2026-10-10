import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { INPUTS } from '../inputs.js';
import {
  HAIKU_4_5,
  SONNET_5,
  affordablePairsPerMonth,
  annualMargin,
  costPerThousandPairs,
  customerCost,
  dailyCapCost,
  emptyRunCost,
  firstMonthMargin,
  margin,
  maxStringsPerRequest,
  runCost,
} from '../model.js';
import { PLANS, planEconomics } from '../plans.js';
import { CANDIDATE_PRICES, SCENARIOS } from '../scenarios.js';

/**
 * Generates cost-model.json from the model, and nothing by hand.
 *
 * The same discipline `packages/eval` uses for the benchmarks the site
 * publishes: a committed artefact plus a test that it matches its generator, so
 * a number cannot be edited into the file without the check noticing. It
 * matters more here — these figures decide a price.
 */
const round = (n: number, places = 4) => Number.parseFloat(n.toFixed(places));

const customers = SCENARIOS.map((shape) => {
  const cost = customerCost(shape);
  return {
    ...shape,
    onboardingCost: round(cost.onboardingCost),
    steadyStateMonthlyCost: round(cost.steadyStateMonthlyCost),
    firstMonthCost: round(cost.firstMonthCost),
    yearOneCost: round(cost.yearOneCost),
    onboardingTruncates: cost.onboardingTruncates,
    requestsNeededAtOnboarding: cost.requestsNeededAtOnboarding,
    margins: CANDIDATE_PRICES.map((price) => ({
      price,
      steadyState: {
        ...margin(price, cost.steadyStateMonthlyCost),
        grossMarginPercent: round(
          margin(price, cost.steadyStateMonthlyCost).grossMarginPercent,
          1,
        ),
        grossMarginDollars: round(
          margin(price, cost.steadyStateMonthlyCost).grossMarginDollars,
        ),
        cogs: round(cost.steadyStateMonthlyCost),
      },
      firstMonth: {
        ...firstMonthMargin(price, cost),
        grossMarginPercent: round(
          firstMonthMargin(price, cost).grossMarginPercent,
          1,
        ),
        grossMarginDollars: round(
          firstMonthMargin(price, cost).grossMarginDollars,
        ),
        cogs: round(cost.firstMonthCost),
      },
      annualPrepaidTenMonths: {
        ...annualMargin(price * 10, cost),
        grossMarginPercent: round(
          annualMargin(price * 10, cost).grossMarginPercent,
          1,
        ),
        grossMarginDollars: round(
          annualMargin(price * 10, cost).grossMarginDollars,
        ),
        cogs: round(cost.yearOneCost),
      },
    })),
  };
});

/** What the levers are worth, measured on the `normal` customer. */
const normal = SCENARIOS.find((s) => s.name === 'normal');
if (!normal) throw new Error('the `normal` scenario is missing');

const levers = {
  baseline: round(customerCost(normal).steadyStateMonthlyCost),
  withPromptCaching: round(
    customerCost({ ...normal, promptCaching: true }).steadyStateMonthlyCost,
  ),
  asConfiguredToday: round(
    customerCost({ ...normal, outputProfile: 'asConfigured' })
      .steadyStateMonthlyCost,
  ),
  onHaiku45: round(
    customerCost({ ...normal, rate: HAIKU_4_5 }).steadyStateMonthlyCost,
  ),
};

/** How much the guessed ambiguity rate moves the answer. */
const ambiguitySweep = [0.02, 0.08, 0.2].map((rate) => ({
  ambiguityRate: rate,
  normalSteadyStateMonthly: round(
    customerCost({ ...normal, ambiguityRate: rate }).steadyStateMonthlyCost,
  ),
  normalOnboarding: round(
    customerCost({ ...normal, ambiguityRate: rate }).onboardingCost,
  ),
}));

/**
 * The unbounded case §C3 named, priced. Not a customer — the thing the cap
 * exists to prevent.
 */
const adversarial = runCost({
  stringsPerLocale: 1_000_000,
  locales: 10,
  retryRate: 0,
});

/** Candidate daily caps, priced at their worst month. */
const dailyCaps = [500, 2000, 5000].map((strings) => ({
  stringsPerDay: strings,
  worstMonthlyCostAt5Locales: round(dailyCapCost(strings, 5)),
  worstMonthlyCostAt25Locales: round(dailyCapCost(strings, 25)),
}));

const unit = {
  costPerThousandPairs: round(costPerThousandPairs()),
  costPerThousandPairsHaiku: round(costPerThousandPairs(HAIKU_4_5)),
  costPerThousandPairsAsConfiguredToday: round(
    costPerThousandPairs(SONNET_5, undefined, 'asConfigured'),
  ),
  emptyRunCostPerLocale: round(emptyRunCost(1), 6),
  affordablePairsPerMonthAt80Margin: Object.fromEntries(
    CANDIDATE_PRICES.map((p) => [p, affordablePairsPerMonth(p)]),
  ),
};

/**
 * The 2026-10-09 production correction, priced.
 *
 * Derived here rather than written down. The token counts are MEASURED and the
 * rate is PUBLISHED, so the dollar figure is the product of the two and has to
 * move when either moves. Writing $0.027264 into a document instead would have
 * survived the next price change unaltered — which is the exact failure this
 * generator exists to prevent, and which the $3/$15 rate had already caused
 * once.
 */
const observed = INPUTS.MEASURED.productionCorrection;
const productionObservation = {
  measuredOn: '2026-10-09',
  source: 'api_usage_daily (organization layersky, usage_date 2026-10-09)',
  repository: 'maxencerousseau38-prog/localize-infra-fixture-i18next',
  pullRequest: 20,
  correctivePullRequest: 21,
  requests: observed.requests,
  inputTokens: observed.inputTokens,
  outputTokens: observed.outputTokens,
  thinkingTokens: observed.thinkingTokens,
  locales: observed.locales,
  keys: observed.keys,
  unitsCharged: observed.unitsCharged,
  unitsApplied: observed.unitsApplied,
  derivedInputCostUsd: round((observed.inputTokens * SONNET_5.input) / 1e6, 6),
  derivedOutputCostUsd: round(
    (observed.outputTokens * SONNET_5.output) / 1e6,
    6,
  ),
  derivedCostUsd: round(
    (observed.inputTokens * SONNET_5.input +
      observed.outputTokens * SONNET_5.output) /
      1e6,
    6,
  ),
  /** Measured tokens times a published rate. Not an invoice, and not compared to one. */
  reconciledAgainstInvoice: false,
  /**
   * Six locales of mixed script with two ambiguity refusals, aggregated with
   * no per-locale breakdown. One correction over a mixture does not establish
   * a cost per string-locale pair.
   */
  establishesCostPerPair: false,
};

const report = {
  generatedBy: 'packages/pricing/src/report/build.ts',
  currency: 'USD',
  model: 'claude-sonnet-5',
  /*
   * One rate, and no expiry. $2/$10 was introductory through 2026-08-31 and
   * Anthropic made it the standard price, cancelling the scheduled rise to
   * $3/$15. There is no longer a second Sonnet 5 rate to report, so the
   * `introductory` and `introductoryUntil` fields are gone rather than
   * retained holding the same numbers as `standard`.
   */
  rates: {
    standard: SONNET_5,
  },
  productionObservation,
  inputs: INPUTS,
  outputCeiling: {
    maxOutputTokensPerRequest: INPUTS.PIPELINE.maxOutputTokensPerRequest,
    chunkSize: maxStringsPerRequest(),
    observedFailingStringsBeforeFix:
      INPUTS.PIPELINE.observedFailingStringsBeforeFix,
    chunkingImplemented: INPUTS.PIPELINE.chunking,
  },
  unit,
  plans: PLANS.map((plan) => {
    const e = planEconomics(plan);
    return {
      ...plan,
      worstMonthlyCogs: round(e.worstMonthlyCogs),
      grossMarginPercentAtCap: round(e.grossMarginPercentAtCap, 1),
      initialImportCogs: round(e.initialImportCogs),
      worstMonthIfDailyCeilingHitDaily: round(
        e.worstMonthIfDailyCeilingHitDaily,
      ),
      monthlyCapBinds: e.monthlyCapBinds,
    };
  }),
  customers,
  levers,
  ambiguitySweep,
  adversarial: {
    stringsPerLocale: 1_000_000,
    locales: 10,
    totalCost: round(adversarial.totalCost, 2),
  },
  dailyCaps,
  fixedMonthlyInfrastructure: {
    supabase: INPUTS.INFRA.supabaseMonthly,
    vercel: INPUTS.INFRA.vercelMonthly,
    vercelPlanVerified: INPUTS.INFRA.vercelPlanVerified,
    storage: INPUTS.INFRA.storageMonthly,
    total:
      INPUTS.INFRA.supabaseMonthly +
      INPUTS.INFRA.vercelMonthly +
      INPUTS.INFRA.storageMonthly,
  },
};

export const REPORT = report;

const here = dirname(fileURLToPath(import.meta.url));
if (process.argv[1]?.includes('build'))
  writeFileSync(
    join(here, 'cost-model.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  );
console.log('wrote cost-model.json');
