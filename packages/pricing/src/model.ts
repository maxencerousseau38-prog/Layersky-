import { ASSUMPTIONS, MEASURED, PIPELINE, PRICES } from './inputs.js';

/**
 * What a run, a project and a customer actually cost.
 *
 * Pure and parameterised, so the sensitive assumptions can be swept rather than
 * argued about. Nothing here reads the environment or the clock.
 */

export interface Rate {
  /** US dollars per million input tokens. */
  input: number;
  /** US dollars per million output tokens. */
  output: number;
}

export const SONNET_5: Rate = {
  input: PRICES.sonnet5.input,
  output: PRICES.sonnet5.output,
};
export const HAIKU_4_5: Rate = {
  input: PRICES.haiku45.input,
  output: PRICES.haiku45.output,
};

export interface RunShape {
  /** Strings sent for translation, per locale. Already-translated keys are not sent. */
  stringsPerLocale: number;
  /** Target locales. One request each. */
  locales: number;
  /** Share of strings the model escalates, 0..1. */
  ambiguityRate?: number;
  /** Multiplier for attempts that failed and were re-run by hand. */
  retryRate?: number;
  rate?: Rate;
  /** Whether the 610-token system prompt is cached between locales. */
  promptCaching?: boolean;
  /**
   * Which measured output profile to bill at.
   *
   * `asConfigured` is what the product does today, and it only returns anything
   * below roughly thirty strings. `effortLow` is the measured fix. Defaults to
   * the fix, because a cost model for a configuration that returns nothing is
   * not a cost model.
   */
  outputProfile?: keyof typeof MEASURED.outputTokensPerString;
  /**
   * Strings per request.
   *
   * 100 was measured to work at `effort: low` (5603 output tokens), so it is
   * the default. The product does not chunk at all today — that is the defect,
   * not the setting.
   */
  chunkSize?: number;
}

export interface RunCost {
  inputTokens: number;
  outputTokens: number;
  /** Requests issued: one per locale, times the retry multiplier. */
  requests: number;
  inputCost: number;
  outputCost: number;
  totalCost: number;
  /**
   * How many requests this run *should* have been split into, given the 4096
   * output-token ceiling. Above 1, the pipeline as written truncates.
   */
  requestsNeededForOutputCeiling: number;
  truncates: boolean;
}

/**
 * The batch size the product actually sends.
 *
 * Was derived as `max_tokens / tokens-per-string`, which gives 63 and was
 * wrong: adaptive thinking spent the same budget, and 40 strings returned no
 * text at all. The pipeline now chunks at a size measured to work rather than
 * at one computed from a ceiling.
 */
export function maxStringsPerRequest(): number {
  return PIPELINE.chunkSize;
}

export function runCost(shape: RunShape): RunCost {
  const {
    stringsPerLocale,
    locales,
    ambiguityRate = ASSUMPTIONS.ambiguityRate,
    retryRate = ASSUMPTIONS.manualRetryRate,
    rate = SONNET_5,
    promptCaching = PIPELINE.promptCaching,
    outputProfile = 'effortLow',
    chunkSize = 100,
  } = shape;

  // A failed attempt is billed in full, so retries multiply everything rather
  // than adding a rounding allowance.
  const attempts = 1 + retryRate;

  // One request per chunk per locale. A run with nothing pending still makes
  // one request per locale, which is why an empty run is not a free run.
  const chunksPerLocale = Math.max(1, Math.ceil(stringsPerLocale / chunkSize));
  const requestCount = chunksPerLocale * locales;
  const requests = requestCount * attempts;

  /*
   * The system prompt is billed per **request**, not per locale — which is the
   * part that surprises. Chunking fixes correctness and multiplies this term by
   * the chunk count, so a large project pays 610 tokens hundreds of times.
   *
   * With caching it is written once and read back at a tenth. Modelled, not
   * claimed: nothing sets `cache_control` today.
   */
  const systemTokens = promptCaching
    ? MEASURED.systemPromptTokens *
      (PRICES.cacheWriteMultiplier +
        (requestCount - 1) * PRICES.cacheReadMultiplier)
    : MEASURED.systemPromptTokens * requestCount;

  const inputTokens =
    (systemTokens +
      stringsPerLocale * MEASURED.inputTokensPerString * locales) *
    attempts;

  /*
   * Output is billed on the measured per-string figure, which already includes
   * thinking. Ambiguous strings carry a question and alternatives on top, so
   * the extra text is added over the base rather than replacing it.
   */
  const perString = MEASURED.outputTokensPerString[outputProfile];
  const ambiguityExtra =
    MEASURED.outputTokensPerAmbiguousString -
    MEASURED.outputTextTokensPerConfidentString;

  const outputTokens =
    stringsPerLocale *
    (perString + ambiguityRate * ambiguityExtra) *
    locales *
    attempts;

  const inputCost = (inputTokens / 1_000_000) * rate.input;
  const outputCost = (outputTokens / 1_000_000) * rate.output;

  const needed = Math.max(
    1,
    Math.ceil(stringsPerLocale / maxStringsPerRequest()),
  );

  return {
    inputTokens,
    outputTokens,
    requests,
    inputCost,
    outputCost,
    totalCost: inputCost + outputCost,
    requestsNeededForOutputCeiling: needed,
    // False now that the pipeline chunks. Kept because the shape it described
    // — work larger than one request can answer — is what chunking exists for,
    // and a future change that removed chunking would light this up again.
    truncates: !PIPELINE.chunking && needed > 1,
  };
}

export interface CustomerShape {
  name: string;
  /** Distinct source strings in the repository. */
  projectStrings: number;
  locales: number;
  projects: number;
  /** New or changed source strings per month, per project. */
  newStringsPerMonth: number;
  /**
   * Runs per month that translate nothing new.
   *
   * These are not free: every run still pays the 610-token system prompt per
   * locale, and a customer with CI wired to run on every merge produces a lot
   * of them.
   */
  emptyRunsPerMonth: number;
  ambiguityRate?: number;
  rate?: Rate;
  promptCaching?: boolean;
  outputProfile?: RunShape['outputProfile'];
  chunkSize?: number;
}

export interface CustomerCost {
  name: string;
  /** The first run: nothing is translated yet, so every string is sent. */
  onboardingCost: number;
  /** Every month after the first. */
  steadyStateMonthlyCost: number;
  /** Month one, which carries onboarding plus that month's ongoing work. */
  firstMonthCost: number;
  /** Twelve months, onboarding included. */
  yearOneCost: number;
  onboardingTruncates: boolean;
  requestsNeededAtOnboarding: number;
}

export function customerCost(shape: CustomerShape): CustomerCost {
  const {
    projectStrings,
    locales,
    projects,
    newStringsPerMonth,
    emptyRunsPerMonth,
    ambiguityRate,
    rate,
    promptCaching,
    outputProfile,
    chunkSize,
  } = shape;

  const onboarding = runCost({
    stringsPerLocale: projectStrings,
    locales,
    ambiguityRate,
    rate,
    promptCaching,
    outputProfile,
    chunkSize,
  });

  const ongoing = runCost({
    stringsPerLocale: newStringsPerMonth,
    locales,
    ambiguityRate,
    rate,
    promptCaching,
    outputProfile,
    chunkSize,
  });

  // A run with nothing to translate still sends the system prompt per locale.
  const emptyRun = runCost({
    stringsPerLocale: 0,
    locales,
    ambiguityRate,
    rate,
    promptCaching,
    outputProfile,
    chunkSize,
  });

  const onboardingCost = onboarding.totalCost * projects;
  const steadyStateMonthlyCost =
    (ongoing.totalCost + emptyRun.totalCost * emptyRunsPerMonth) * projects;

  return {
    name: shape.name,
    onboardingCost,
    steadyStateMonthlyCost,
    firstMonthCost: onboardingCost + steadyStateMonthlyCost,
    yearOneCost: onboardingCost + steadyStateMonthlyCost * 12,
    onboardingTruncates: onboarding.truncates,
    requestsNeededAtOnboarding: onboarding.requestsNeededForOutputCeiling,
  };
}

export interface MarginRow {
  price: number;
  cogs: number;
  grossMarginDollars: number;
  grossMarginPercent: number;
}

/**
 * Gross margin on the variable cost only.
 *
 * Fixed infrastructure is excluded deliberately: it does not vary per customer
 * at this scale, so folding it in would make margin a function of how many
 * customers there are rather than of what one costs to serve. The report states
 * the fixed floor separately and says how many customers clear it.
 */
export function margin(price: number, cogs: number): MarginRow {
  return {
    price,
    cogs,
    grossMarginDollars: price - cogs,
    grossMarginPercent: price === 0 ? 0 : ((price - cogs) / price) * 100,
  };
}

/**
 * The month-one margin, which is the one that decides whether a plan survives.
 *
 * A customer who onboards and churns inside thirty days pays once and costs
 * onboarding plus a month. §C3 named this shape and never quantified it.
 */
export function firstMonthMargin(
  price: number,
  customer: CustomerCost,
): MarginRow {
  return margin(price, customer.firstMonthCost);
}

/** Annual prepay against a full year of cost, onboarding included. */
export function annualMargin(
  annualPrice: number,
  customer: CustomerCost,
): MarginRow {
  return margin(annualPrice, customer.yearOneCost);
}

/**
 * The daily translation ceiling that bounds the adversarial case.
 *
 * Expressed as strings per day rather than words ever, because invariant 3
 * forbids billing by volume: a compute guard protects the business from a
 * runaway job without turning the subscription into a meter. This returns what
 * a given daily cap costs at worst, so the cap can be chosen from a number.
 */
export function dailyCapCost(
  stringsPerDay: number,
  locales: number,
  rate: Rate = SONNET_5,
  ambiguityRate: number = ASSUMPTIONS.ambiguityRate,
): number {
  const day = runCost({
    stringsPerLocale: stringsPerDay,
    locales,
    ambiguityRate,
    retryRate: 0,
    rate,
  });
  return day.totalCost * 30;
}

/**
 * The unit the whole business should be reasoned in: one string, one locale.
 *
 * Everything else in this file is this number multiplied by a shape. Strings
 * alone are not the driver — a string translated into 25 languages costs 25
 * times a string translated into one — and neither are runs, because an
 * incremental run sends almost nothing. The pair is what the bill is made of.
 *
 * Excludes the per-request system prompt, which amortises away at realistic
 * chunk sizes (610 tokens over 100 strings is 6 per string, against 219). The
 * exception is a run with nothing to translate, where the system prompt is the
 * entire cost — priced separately by `emptyRunCost`.
 */
export function costPerThousandPairs(
  rate: Rate = SONNET_5,
  ambiguityRate: number = ASSUMPTIONS.ambiguityRate,
  outputProfile: NonNullable<RunShape['outputProfile']> = 'effortLow',
): number {
  const inputCost =
    (MEASURED.inputTokensPerString / 1_000_000) * rate.input * 1000;
  const outputTokens =
    MEASURED.outputTokensPerString[outputProfile] +
    ambiguityRate *
      (MEASURED.outputTokensPerAmbiguousString -
        MEASURED.outputTextTokensPerConfidentString);
  const outputCost = (outputTokens / 1_000_000) * rate.output * 1000;
  return inputCost + outputCost;
}

/**
 * What a run that translates nothing costs.
 *
 * A customer with CI wired to the pipeline produces these constantly, and they
 * are not free: one request per locale, each paying the full system prompt.
 * This is the cost of being connected, and it is the one line that grows with
 * locales while delivering nothing.
 */
export function emptyRunCost(locales: number, rate: Rate = SONNET_5): number {
  return ((MEASURED.systemPromptTokens * locales) / 1_000_000) * rate.input;
}

/**
 * The monthly pair allowance a price can afford at a target gross margin.
 *
 * This is the number a plan's cap should be set from, rather than from a round
 * figure that feels generous.
 */
export function affordablePairsPerMonth(
  price: number,
  targetGrossMargin = 0.8,
  rate: Rate = SONNET_5,
): number {
  const budget = price * (1 - targetGrossMargin);
  return Math.floor((budget / costPerThousandPairs(rate)) * 1000);
}
