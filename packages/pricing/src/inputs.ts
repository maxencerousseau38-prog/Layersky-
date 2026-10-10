/**
 * Every number the cost model rests on, sorted by how much it can be trusted.
 *
 * The whole point of this file is the sort order. `docs/product/08-critique.md`
 * §C3 refused to let a price be published because the unit economics were
 * "rough arithmetic" — a table of plausible figures with no provenance. The fix
 * is not better arithmetic, it is knowing which inputs are facts and which are
 * guesses, so that when a number turns out to be wrong it is obvious whether
 * the model was wrong or the world was.
 *
 * Three tiers, and nothing may move up a tier without evidence:
 *
 *   MEASURED  — obtained by running something. Each carries how and when.
 *   PUBLISHED — a price a vendor states. Each carries the source and date.
 *   ASSUMED   — a guess. Each carries what would settle it.
 */

/* ------------------------------------------------------------------ *
 * MEASURED — this repository's real prompt, on its real corpus.
 * ------------------------------------------------------------------ */

/**
 * Measured 2026-08-21 with `POST /v1/messages/count_tokens` (free of charge)
 * against `claude-sonnet-5`, using:
 *
 *   - the `INSTRUCTIONS` constant read from apps/api/src/translate/prompt.ts,
 *   - real rows from packages/eval/src/corpus/data/entries.json,
 *   - the item shape `buildBatchPrompt` actually sends.
 *
 * Not estimated from characters. A chars/token ratio is exactly the kind of
 * plausible-looking assumption §C3 objected to.
 */
export const MEASURED = {
  /**
   * The system prompt, billed once per request — which means once per target
   * locale per run, because the pipeline sends one request per locale.
   *
   * 610 tokens is small in isolation and is not small at ten locales on a
   * weekly cadence: it is the part of the bill that does not shrink when a
   * project's strings are already translated.
   */
  systemPromptTokens: 610,

  /**
   * Marginal input tokens per string, including its file path, component name
   * and surrounding code.
   *
   * From the 128 corpus rows that carry surrounding code — the population that
   * matches a real extraction, because `packages/core` always emits it
   * (CONTEXT_LINES_BEFORE = 3, CONTEXT_LINES_AFTER = 2, so six lines per
   * string). Measured across batch sizes 25/50/100/128: 200.2, 198.3, 216.4,
   * 219.2. The largest batch is used because it is the one a real run looks
   * like.
   *
   * The first pass over the whole corpus gave 138 tokens/string and was
   * discarded: half those rows have an empty `surroundingCode`, which no
   * extraction produces. Recording the discarded figure because it is the
   * number an unwary re-measurement would land on, and it understates cost by
   * about a third.
   */
  inputTokensPerString: 219,

  /**
   * Output tokens for a string the model is confident about: `key`, `text`,
   * `confidence`. Measured on responses built from the corpus's own human
   * reference translations — 3678 tokens for 50 strings, 6488 for 100.
   *
   * This is the **text** only, and on its own it is a trap. It was the number
   * this model first used, and it understated the bill by roughly 3x, because
   * `claude-sonnet-5` runs adaptive thinking by default and thinking tokens are
   * billed as output. See `outputTokensPerString` below for what a real request
   * actually costs.
   */
  outputTextTokensPerConfidentString: 65,

  /**
   * Output tokens per string as **actually billed**, thinking included.
   *
   * Measured 2026-08-21 with real `POST /v1/messages` calls against
   * `claude-sonnet-5`, using this repo's prompt and corpus:
   *
   *   | strings | config              | output | thinking | usable |
   *   |---------|---------------------|--------|----------|--------|
   *   |       5 | as configured today |    413 |       82 | yes    |
   *   |      20 | as configured today |   3186 |     1799 | yes    |
   *   |      40 | as configured today |   4096 |     4096 | **no** |
   *   |      40 | effort: low         |   2505 |       47 | yes    |
   *   |     100 | effort: low         |   5603 |       85 | yes    |
   *
   * Thinking grows superlinearly with batch size and, at the configured
   * `max_tokens: 4096`, consumes the entire budget before any text is emitted.
   */
  outputTokensPerString: {
    /**
     * What the product bills today, at a batch small enough to succeed.
     * 3186/20 at twenty strings — and it stops working above roughly thirty.
     */
    asConfigured: 159,
    /**
     * With `output_config: { effort: 'low' }`, as production sends.
     *
     * **75, re-measured 2026-08-24** over the full 414-entry corpus, after two
     * rounds of escalation tuning: 30,880 output tokens / 414 strings. It was
     * 56, from 5603/100 on a hundred-string sample. The same corpus measured
     * 59.8 before the first round, 73.1 after it, and 74.6 after the second —
     * so the first change accounts for almost all of it and the difference is
     * not sampling noise.
     *
     * The change is the `cue` field. Tuning escalation to the owner's target
     * (60% recall at ≥80% precision) required the model to write down what
     * forced a choice and what settled it before answering; an unwritten step
     * was a step not taken. That reasoning is output tokens, and output tokens
     * are five times the price of input on this model.
     *
     * So invariant 4 now has two lines on the bill rather than one: this,
     * paid on **every** string, and `outputTokensPerAmbiguousString` below,
     * paid only on the ones it raises. See `docs/product/12-ambiguity-benchmark.md`.
     */
    effortLow: 75,
    /** `claude-haiku-4-5` with thinking disabled. 2185/40. Quality unmeasured. */
    haikuThinkingDisabled: 55,
  },

  /**
   * A string the model escalates costs roughly 3.7× more to emit, because it
   * also carries `question` and two or more `alternatives` with rationales.
   * Measured at 239 tokens/string over 10 rows.
   *
   * This is what invariant 4 costs. It is worth stating plainly rather than
   * burying: escalating instead of guessing is a real line on the bill.
   */
  outputTokensPerAmbiguousString: 239,

  /**
   * The first production correction with token accounting — and the first
   * entry in this file not obtained in a harness.
   *
   * Measured 2026-10-09 on `localize-infra-fixture-i18next` #20: one English
   * key (`errors.rateLimited`) added to the source catalogue and absent from
   * all six target locales. One `pull_request.opened` delivery, no retries,
   * corrective pull request #21 thirty-one seconds later.
   *
   * Read from `api_usage_daily` (organization `layersky`, usage_date
   * 2026-10-09) — the row `consume_api_quota` writes as it charges, not a
   * second count re-derived from `runs`.
   *
   * **The consumption is measured; the dollar figure is not.** It is this
   * consumption multiplied by the PUBLISHED rate below, which makes it a
   * *derived* cost and not an amount reconciled against a provider invoice.
   * No invoice has been compared to it, and until one is, this settles what
   * the product consumes rather than what it is billed.
   *
   * **One observation, six mixed locales — not a cost per pair.** `ar` and
   * `ja` are non-Latin and tokenise more densely than the German-only harness
   * this model was built on, and two of the six were refused as ambiguous,
   * each emitting the model's question as extra output. `api_usage_daily`
   * aggregates per workspace-day with no per-locale breakdown, so those two
   * causes cannot be separated from one another. Establishing a cost per
   * string-locale pair needs several corrections over known locale sets; this
   * is one correction over a mixture.
   */
  productionCorrection: {
    /** `model_requests` — one call per target locale, no retry. */
    requests: 6,
    /** `input_tokens`. 1641 per call, against 1625 predicted by the harness fit. */
    inputTokens: 9_847,
    /** `output_tokens`, thinking included. 126 per call against 44 in the harness. */
    outputTokens: 757,
    /** `thinking_tokens`. Zero, as the harness also measured at this batch size. */
    thinkingTokens: 0,
    /** ar, de, es, fr, ja, pt-BR. */
    locales: 6,
    /** Source keys the pull request changed. */
    keys: 1,
    /** Charged for what was sent. `de` and `es` were refused as ambiguous. */
    unitsCharged: 6,
    unitsApplied: 4,
  },
} as const;

/* ------------------------------------------------------------------ *
 * REPO FACTS — behaviour read from the code, not guessed at.
 * ------------------------------------------------------------------ */

export const PIPELINE = {
  /**
   * `max_tokens` on the Anthropic call (apps/api/src/router/anthropic.ts).
   *
   * 16384 now, and it has moved twice for two different reasons.
   *
   * It was 4096, and that did not merely truncate — it returned nothing.
   * Arithmetic said 4096 bounded a request at 4096/65 ≈ 63 strings; arithmetic
   * was wrong, because adaptive thinking spends the same budget. Verified at
   * 40 and at 80 strings: both spent the full 4096 tokens on thinking and
   * produced an empty content block. That took it to 8192.
   *
   * 8192 then stopped being enough when the escalation tuning added the `cue`
   * field: output per string went 60 → 75, so a full 100-string chunk emits
   * ~7,500 and no longer clears the 75% headroom a chunk needs — a chunk with
   * a dozen escalations at 239 tokens each would have truncated. `model.test.ts`
   * caught it the moment `effortLow` was updated, before any run failed.
   */
  maxOutputTokensPerRequest: 16384,

  /**
   * `output_config.effort` on the Anthropic call.
   *
   * `low` collapses the thinking that was consuming the whole budget: 75
   * measured output tokens per string against 159 at the default. It is both
   * the correctness fix and a 2.1x saving — it was 2.8x before the `cue` field
   * raised the numerator.
   *
   * Its effect on **quality** is now measured, and it is nil: re-running the
   * 414-entry harness across the prompt change gave chrF 75.20 against 75.23,
   * identical exact-match, 100% placeholder integrity and zero glossary
   * violations. See `docs/product/12-ambiguity-benchmark.md`.
   */
  effort: 'low',

  /**
   * The batch that broke it, kept as the reason the ceiling above moved.
   * 20 strings answered; 40 returned nothing.
   */
  observedMaxUsableStringsBeforeFix: 20,
  observedFailingStringsBeforeFix: 40,

  /**
   * Strings per request, from `MAX_STRINGS_PER_REQUEST` in
   * apps/api/src/translate/handler.ts.
   *
   * Measured to work: a 100-string chunk at `effort: low` emits 5,603 output
   * tokens against the 8,192 ceiling, and 250 strings through the real handler
   * returned 250 translations with none missing.
   */
  chunkSize: 100,

  /**
   * Chunked, in `handleTranslateBatch`.
   *
   * It was not, and that was the defect: one request per locale carrying every
   * pending string, so the size of a request was the size of the customer's
   * repository. Chunking lives in the API rather than in each of the two
   * callers, so the CLI and apps/web cannot drift apart on it.
   */
  chunking: true,

  /**
   * Attempts per chunk, including the first.
   *
   * This was 0 — "no retry exists on the translate call, a failure ends the
   * run" — which is what `docs/product/10-model-benchmark.md` measured costing
   * a whole locale to one unparseable response. A chunk is now tried up to
   * three times with exponential backoff, and a retry asks only for the keys
   * still missing rather than re-sending the chunk.
   */
  attemptsPerChunk: 3,

  /**
   * No `cache_control` is set on any request, so the 610-token system prompt is
   * billed in full every time. This is the single largest *available* saving
   * and it is not taken today.
   */
  promptCaching: false,

  /**
   * Only keys with no existing translation are sent (run-actions.ts).
   *
   * This is the most important cost control in the product and it already
   * exists. It is what makes steady state cheap and it is why the model below
   * separates the first run from every run after it.
   */
  incremental: true,
} as const;

/* ------------------------------------------------------------------ *
 * PUBLISHED — vendor prices. Source and date on each.
 * ------------------------------------------------------------------ */

/** US dollars per million tokens. */
export const PRICES = {
  /**
   * Anthropic list price. **$2.00/$10.00 per million, and permanent.**
   *
   * `claude-sonnet-5` is the configured default
   * (apps/api/src/index.ts: API_ANTHROPIC_MODEL ?? 'claude-sonnet-5').
   *
   * Source: the Anthropic pricing table, footnote 3, read 2026-10-10 —
   * "The $2/$10 per million input/output token pricing for Claude Sonnet 5,
   * announced at launch as introductory pricing through August 31, 2026, is
   * now the standard price. The previously scheduled increase to $3/$15 per
   * million input/output tokens on September 1, 2026 will not occur."
   *
   * This file modelled $3.00/$15.00 until 2026-10-10, on the stated reasoning
   * that a model built on a rate due to expire would be obsolete on arrival.
   * The reasoning was sound and the world went the other way: the
   * introductory rate became the standard one. Input and output each fall by
   * exactly one third, so every derived figure downstream moves.
   *
   * There is now **no second Sonnet 5 rate** — `introInput`/`introOutput` are
   * gone rather than kept at the same value, because a lever whose two sides
   * are identical measures nothing.
   *
   * The announcement date is deliberately not recorded. The official page
   * carries none, and third-party coverage splits between 2026-08-10 and
   * 2026-08-11, so a date here would be the one unsourced number in a file
   * whose entire purpose is provenance.
   */
  sonnet5: { input: 2.0, output: 10.0 },

  /**
   * The cheap-model option. Same source and date.
   *
   * Modelled but not adopted: routing to it is a quality decision that the
   * eval harness exists to settle, and that evaluation has not been run for
   * this task. Included so the saving is quantified rather than assumed.
   */
  haiku45: { input: 1.0, output: 5.0 },

  /**
   * Multipliers on the input rate. Cache reads are ~0.1x and cache writes
   * ~1.25x; the Batch API runs asynchronously at 50%.
   *
   * Batch is listed for completeness and is a poor fit here: a run is
   * interactive and its output is a pull request somebody is waiting for.
   */
  cacheReadMultiplier: 0.1,
  cacheWriteMultiplier: 1.25,
  batchMultiplier: 0.5,
} as const;

/**
 * Fixed monthly infrastructure, in US dollars.
 *
 * Deliberately modelled as a fixed floor rather than per-customer: at the scale
 * this product is at, none of it varies with one more customer. That stops
 * being true somewhere past the free tiers, and the point at which it does is
 * called out in the report rather than smoothed into a per-customer number.
 */
export const INFRA = {
  /**
   * Supabase. The organisation is on the free plan — established
   * independently: leaked-password protection is Pro-only and is recorded in
   * CLAUDE.md as unavailable for that reason.
   *
   * $0 today. Pro is $25/month and becomes necessary before it becomes
   * optional: the free plan pauses inactive projects and caps the database at
   * 500 MB.
   */
  supabaseMonthly: 0,
  supabaseProMonthly: 25,

  /**
   * Vercel. **Not verified.** `vercel teams ls` names the team but not its
   * plan, and no read-only command in this session established it.
   *
   * Modelled at the Pro rate because the alternative is not a cheaper plan, it
   * is a licence violation: Vercel's Hobby plan prohibits commercial use, so
   * the first paying customer requires Pro regardless of consumption. Treating
   * this as $0 would understate the cost of being allowed to sell at all.
   */
  vercelMonthly: 20,
  vercelPlanVerified: false,

  /**
   * Git is the source of truth (invariant 1) and Postgres is an index, so the
   * product stores no translations of its own. Storage cost is the database
   * rows recording runs, and it is inside the free tier by orders of
   * magnitude — a run is a handful of rows.
   */
  storageMonthly: 0,
} as const;

/* ------------------------------------------------------------------ *
 * ASSUMED — guesses. Each says what would replace it with a fact.
 * ------------------------------------------------------------------ */

export const ASSUMPTIONS = {
  /**
   * Share of strings the model escalates.
   *
   * **This was a guess of 8%, and observation puts it far lower.** Two runs of
   * 250 corpus strings through the real `handleTranslateBatch` into German on
   * 2026-08-22 returned 250 translations each, with 2 and then 5 ambiguous —
   * 0.8% and 2.0%.
   *
   * The value here is the **higher** of the two. A cost model must not round in
   * its own favour, and two samples that differ by 2.5x are a range rather than
   * a number.
   *
   * Kept in this tier rather than promoted to measured, because one locale and
   * one corpus is not a rate. German forces a du/Sie choice many languages do
   * not, and the corpus is drawn from open-source projects whose strings have
   * already been through a translation process once — both push the number
   * around. This is a measurement of one case being used as the estimate for
   * all of them.
   *
   * What has changed is that the model is no longer built on a figure known to
   * be wrong. The sweep below still runs 2%/8%/20%, and matters less than it
   * looked: across that whole range the typical customer moves by 22%, on a
   * line that is 4% of the cheapest plan.
   *
   * Settled properly by: the same measurement across every target locale, on
   * real application strings rather than already-translated ones.
   */
  ambiguityRate: 0.02,

  /**
   * Share of runs that fail and are retried by a human.
   *
   * This said "there is no automatic retry, so this is a person clicking
   * again". There is one now — `handleTranslateBatch` retries a chunk up to
   * three times with exponential backoff — so the 10% here covers only what
   * survives it: a run that failed for a reason retrying cannot fix.
   *
   * The automatic retry is **not** modelled as an extra 10%, and leaving the
   * figure unchanged is the conservative choice rather than an oversight. On
   * the recommended configuration the benchmark measured zero chunk failures
   * over 414 strings and eleven requests, so the retry costs nothing in the
   * common case; when it does fire it re-sends only the keys still missing,
   * which is a fraction of a chunk. Both effects are inside the noise of a
   * figure that is itself a guess.
   *
   * Settled by: the `runs` table, once there are enough runs to count. Today
   * production holds zero.
   */
  manualRetryRate: 0.1,

  /**
   * How much of a project's source text is already translated when a customer
   * arrives. Zero for the first run by definition; this is the ongoing case.
   *
   * Settled by: the first ten real projects.
   */
  steadyStateTranslatedShare: 0.95,
} as const;

/** Everything, in one object, so the report can print its own provenance. */
export const INPUTS = {
  MEASURED,
  PIPELINE,
  PRICES,
  INFRA,
  ASSUMPTIONS,
} as const;
