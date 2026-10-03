import { z } from 'zod';

export const TranslatableStringSchema = z.object({
  key: z.string().min(1),
  text: z.string().min(1),
  filePath: z.string(),
  componentName: z.string().nullable(),
  surroundingCode: z.string(),
});
export type TranslatableString = z.infer<typeof TranslatableStringSchema>;

// targetLocale reaches two sinks: an LLM system prompt (apps/api/src/translate/prompt.ts)
// and, on the CLI side, a filesystem path via `locales/<locale>.json` (packages/cli's
// writeLocaleFile). A BCP-47-ish allowlist keeps it from being anything but a short
// language/region tag, ruling out path-traversal-shaped values like `../../x` or
// prompt-injection-shaped values containing whitespace/newlines.
const LOCALE_TAG_PATTERN = /^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$/;

export const TranslateBatchRequestSchema = z.object({
  targetLocale: z.string().min(1).regex(LOCALE_TAG_PATTERN, {
    message:
      'targetLocale must be a valid locale/language tag (e.g. "de", "pt-BR")',
  }),
  strings: z.array(TranslatableStringSchema).min(1),
});
export type TranslateBatchRequest = z.infer<typeof TranslateBatchRequestSchema>;

/**
 * One alternative reading of an ambiguous source string.
 *
 * `rationale` is what makes the queue answerable rather than a quiz: a
 * developer picking between two German words needs to know what distinguishes
 * them, not just that two exist.
 */
export const TranslationAlternativeSchema = z.object({
  text: z.string().min(1),
  rationale: z.string().min(1),
});
export type TranslationAlternative = z.infer<
  typeof TranslationAlternativeSchema
>;

/**
 * A translated string, and how sure the model was.
 *
 * Invariant 4 of this project: the agent raises ambiguity, it does not guess.
 * That is only enforceable if the model is allowed to say "I am not sure, and
 * here is why" — so the contract carries it. Without this field the pipeline
 * had no way to distinguish a confident translation from a coin flip, and
 * shipped both identically.
 *
 * `confidence` defaults to 'confident' so a model that answers in the older,
 * two-field shape is treated as sure of itself rather than crashing the batch.
 * That default is deliberate but not free: it means a provider silently
 * dropping the field produces no escalations at all. `question` being required
 * whenever confidence is 'ambiguous' is what keeps that from degrading quietly
 * — an escalation with nothing to ask is refused at the schema.
 */
export const TranslatedStringSchema = z
  .object({
    key: z.string().min(1),
    text: z.string(),
    confidence: z.enum(['confident', 'ambiguous']).default('confident'),
    /** Why a human is needed. Required when confidence is 'ambiguous'. */
    question: z.string().min(1).nullable().default(null),
    alternatives: z.array(TranslationAlternativeSchema).default([]),
  })
  .refine(
    (value) => value.confidence === 'confident' || value.question !== null,
    {
      message: 'An ambiguous translation must carry a question',
      path: ['question'],
    },
  );
export type TranslatedString = z.infer<typeof TranslatedStringSchema>;

/**
 * A chunk the API gave up on, and what it was trying when it did.
 *
 * `missingKeys` says a string has no translation. It does not say whether the
 * model answered and left it out, or whether every attempt at that chunk came
 * back unparseable — and those want different reactions from a caller. The
 * first is a model being incomplete; the second is a run that lost work to a
 * fault and should say so.
 *
 * The error is carried verbatim (DESIGN.md §8): a customer comparing this
 * against their own logs must see the same string.
 */
export const ChunkFailureSchema = z.object({
  /** The keys that had no translation when the attempts ran out. */
  keys: z.array(z.string()),
  /** How many times the chunk was tried, including the first. */
  attempts: z.number().int().min(1),
  /** The last error, as the provider or parser produced it. */
  error: z.string(),
});
export type ChunkFailure = z.infer<typeof ChunkFailureSchema>;

/**
 * `failures` defaults to an empty array rather than being required, so an
 * older client and a newer API keep working in both directions. A caller that
 * ignores it sees exactly what it saw before.
 */
/**
 * What the model calls behind one request consumed.
 *
 * Optional and defaulted, so a deployment that does not report it and a client
 * that ignores it both keep working — the same compatibility rule `failures`
 * follows. `requests` is model calls, which is **not** one per API request:
 * one request becomes one call per chunk, and up to three when a chunk is
 * retried.
 *
 * Tokens, never money. Vendor rates change and differ per model; converting is
 * arithmetic the reader does with today's rate, and a dollar figure frozen into
 * a response is wrong the moment the rate moves with nothing to say which rate
 * produced it.
 */
export const TokenUsageSchema = z.object({
  requests: z.number().int().min(0),
  inputTokens: z.number().int().min(0),
  outputTokens: z.number().int().min(0),
  /** A subset of `outputTokens`, not an addition to it. */
  thinkingTokens: z.number().int().min(0),
});
export type TokenUsage = z.infer<typeof TokenUsageSchema>;

export const TranslateBatchResponseSchema = z.object({
  translations: z.array(TranslatedStringSchema),
  missingKeys: z.array(z.string()),
  failures: z.array(ChunkFailureSchema).default([]),
  usage: TokenUsageSchema.default({
    requests: 0,
    inputTokens: 0,
    outputTokens: 0,
    thinkingTokens: 0,
  }),
});
export type TranslateBatchResponse = z.infer<
  typeof TranslateBatchResponseSchema
>;
