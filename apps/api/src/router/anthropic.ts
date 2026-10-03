import type {
  Provider,
  TokenUsage,
  TranslateRequest,
  TranslateResult,
} from './types.js';

/**
 * Usage, as the API reports it.
 *
 * Thinking is billed as output and is the term that made a 4096-token ceiling
 * return nothing, so it is surfaced separately rather than folded into
 * `outputTokens` — a total that hides it hides the thing worth watching.
 */
export interface AnthropicUsage {
  inputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
}

/**
 * Knobs the benchmark varies, defaulting to exactly what production sends.
 *
 * Parameterised so that measuring a configuration and shipping one use the
 * same code. The alternative was a second request builder inside the eval
 * harness, which would have made "we benchmarked the production path" true
 * only until the two drifted — and it would drift silently, because both would
 * keep working.
 *
 * **Every default below is the current production value.** Passing no options
 * changes nothing, and a test pins the default request body so that stays
 * true.
 */
export interface AnthropicSettings {
  maxTokens?: number;
  /** `null` omits `output_config` entirely, which is the model's own default. */
  effort?: 'low' | 'medium' | 'high' | null;
  /** `'disabled'` turns thinking off; `null` omits the field. */
  thinking?: 'disabled' | null;
}

export function createAnthropicProvider(
  apiKey: string,
  settings: AnthropicSettings = {},
): Provider {
  const {
    /*
     * 8192, and the previous 4096 was not merely tight — it returned nothing.
     *
     * `claude-sonnet-5` runs adaptive thinking by default and thinking tokens
     * are billed against this ceiling. Measured 2026-08-21 on this
     * repository's own prompt and corpus: at 40 strings the model spent all
     * 4096 tokens reasoning and emitted an empty content block, so `translate`
     * below threw and the run failed. Reproduced at 80. A 100-string batch at
     * the effort below needed 5,603.
     *
     * **16384 since 2026-08-24**, because that last figure changed. Tuning
     * escalation to the owner's target added a `cue` field the model fills
     * before answering, and output per string went from 60 to 73 measured on
     * the same 414-entry corpus. A full 100-string chunk now emits about
     * 7,300 — still under 8192, but past the headroom a chunk needs, since a
     * string the model escalates costs roughly 239 tokens rather than 73 and
     * a chunk with a dozen of them would have truncated.
     *
     * `packages/pricing/src/model.test.ts` caught this, not a production
     * failure: it asserts a chunk fits under 75% of the ceiling, and 7,300
     * against 6,144 failed the moment the measured input was updated.
     *
     * Raised rather than chunking smaller because this ceiling is billed on
     * what is emitted, not on what is allowed. Halving the chunk size would
     * have re-sent the system prompt twice as often and paid for it in input
     * tokens; raising the ceiling costs nothing until the tokens are actually
     * used.
     */
    maxTokens = 16384,
    /*
     * Batch translation is not a reasoning task, and paying for reasoning here
     * bought a failure rather than accuracy.
     *
     * Measured output per string: 159 tokens at the default effort against 56
     * at `low` — 2.8x cheaper, and the difference between a batch that answers
     * and one that does not.
     */
    effort = 'low',
    thinking = null,
  } = settings;

  return {
    name: 'anthropic',
    async translate(
      req: TranslateRequest,
      modelId: string,
    ): Promise<TranslateResult> {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: modelId,
          max_tokens: maxTokens,
          // Omitted rather than sent as null when unset: `effort` is rejected
          // outright by models that do not support it, and Haiku 4.5 is one.
          ...(effort ? { output_config: { effort } } : {}),
          ...(thinking ? { thinking: { type: thinking } } : {}),
          system: req.systemPrompt,
          messages: [{ role: 'user', content: req.userPrompt }],
        }),
      });
      if (!response.ok) {
        throw new Error(
          `Anthropic API error ${response.status}: ${await response.text()}`,
        );
      }
      const body = (await response.json()) as {
        content: { type: string; text: string }[];
        usage?: {
          input_tokens?: number;
          output_tokens?: number;
          output_tokens_details?: { thinking_tokens?: number };
        };
      };

      /*
       * Read before the content check, and attached to the error when there is
       * no text.
       *
       * A response that spent its whole budget thinking and returned nothing
       * still cost a full request. Reporting usage only on success would make
       * exactly the most expensive failure invisible in the totals — and that
       * failure is the one a cost model most needs to see.
       */
      const usage: TokenUsage = {
        inputTokens: body.usage?.input_tokens ?? 0,
        outputTokens: body.usage?.output_tokens ?? 0,
        thinkingTokens: body.usage?.output_tokens_details?.thinking_tokens ?? 0,
      };

      const textBlock = body.content.find((block) => block.type === 'text');
      if (!textBlock || !textBlock.text.trim()) {
        throw Object.assign(
          new Error('Anthropic response had no usable text content block'),
          { usage },
        );
      }
      return { text: textBlock.text.trim(), usage };
    },
  };
}
