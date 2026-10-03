import type { Provider, TranslateRequest, TranslateResult } from './types.js';

export function createOpenAiProvider(
  apiKey: string,
  baseUrl = 'https://api.openai.com/v1',
): Provider {
  return {
    name: 'openai',
    async translate(
      req: TranslateRequest,
      modelId: string,
    ): Promise<TranslateResult> {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: modelId,
          messages: [
            { role: 'system', content: req.systemPrompt },
            { role: 'user', content: req.userPrompt },
          ],
        }),
      });
      if (!response.ok) {
        throw new Error(
          `OpenAI API error ${response.status}: ${await response.text()}`,
        );
      }
      const body = (await response.json()) as {
        choices: { message: { content: string } }[];
        usage?: {
          prompt_tokens?: number;
          completion_tokens?: number;
          completion_tokens_details?: { reasoning_tokens?: number };
        };
      };
      /*
       * OpenAI's names, mapped to the shared shape. `reasoning_tokens` is this
       * provider's word for thinking and is likewise a subset of completion
       * tokens, so it lands in the same field and is not added twice.
       */
      const usage = body.usage
        ? {
            inputTokens: body.usage.prompt_tokens ?? 0,
            outputTokens: body.usage.completion_tokens ?? 0,
            thinkingTokens:
              body.usage.completion_tokens_details?.reasoning_tokens ?? 0,
          }
        : null;
      const content = body.choices[0]?.message.content;
      if (!content) throw new Error('OpenAI response had no message content');
      return { text: content.trim(), usage };
    },
  };
}
