export interface TranslateRequest {
  systemPrompt: string;
  userPrompt: string;
}

/**
 * What one model call consumed.
 *
 * Returned rather than reported through a callback. The Anthropic provider had
 * an `onUsage` hook for this, and the two eval harnesses in `apps/api/eval`
 * passed it — which is how `docs/product/09-unit-economics.md` has a measured
 * benchmark cost at all. What it could never do is reach production: a side
 * channel wired at construction has the wrong lifetime, because cost has to be
 * attributed to a *request* and the provider is built once at startup. So the
 * number existed for the benchmark and nowhere else.
 *
 * The harnesses now read this instead, which is the same figure plus the
 * retried attempts the hook could see but `usage.length` conflated with calls.
 *
 * `thinkingTokens` is a subset of `outputTokens`, not an addition to it. It is
 * carried separately because it is the one line an `effort` setting moves, and
 * without it a cost regression from a settings change is indistinguishable
 * from ordinary growth.
 */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
}

export interface TranslateResult {
  text: string;
  /**
   * Absent when the provider did not report it. Null rather than zero: a
   * provider that reports nothing and one that genuinely used nothing are
   * different facts, and summing them as zero would quietly understate a bill.
   */
  usage: TokenUsage | null;
}

export interface Provider {
  name: 'anthropic' | 'openai';
  translate(req: TranslateRequest, modelId: string): Promise<TranslateResult>;
}
