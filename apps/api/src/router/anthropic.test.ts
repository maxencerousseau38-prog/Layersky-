import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAnthropicProvider } from './anthropic.js';
import type { TokenUsage } from './types.js';

/**
 * The request body, pinned.
 *
 * `createAnthropicProvider` became parameterised so the benchmark could vary
 * the settings without a second request builder that would drift from this
 * one. That is only safe while the **defaults** are exactly what production
 * sends, so this asserts them rather than trusting the comment that says so.
 */
const OK = {
  ok: true,
  json: async () => ({
    content: [{ type: 'text', text: '[]' }],
    usage: {
      input_tokens: 11,
      output_tokens: 22,
      output_tokens_details: { thinking_tokens: 3 },
    },
  }),
};

function captureBody() {
  const calls: Record<string, unknown>[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: { body: string }) => {
      calls.push(JSON.parse(init.body));
      return OK;
    }),
  );
  return calls;
}

const request = { systemPrompt: 'sys', userPrompt: 'user' };

afterEach(() => vi.unstubAllGlobals());

describe('createAnthropicProvider defaults', () => {
  it('sends exactly what production sends when given no settings', async () => {
    const calls = captureBody();
    await createAnthropicProvider('k').translate(request, 'claude-sonnet-5');

    // 16384 since 2026-08-24. The `cue` field added by the escalation tuning
    // took output per string from 60 to 73, so a full 100-string chunk emits
    // ~7,300 and no longer cleared the headroom 8192 left it — see the
    // rationale on `maxTokens` in anthropic.ts.
    expect(calls[0]).toEqual({
      model: 'claude-sonnet-5',
      max_tokens: 16384,
      output_config: { effort: 'low' },
      system: 'sys',
      messages: [{ role: 'user', content: 'user' }],
    });
  });

  it('omits thinking by default rather than sending null', async () => {
    const calls = captureBody();
    await createAnthropicProvider('k').translate(request, 'claude-sonnet-5');
    expect(calls[0]).not.toHaveProperty('thinking');
  });
});

describe('createAnthropicProvider settings', () => {
  it('omits output_config when effort is null', async () => {
    // Haiku 4.5 rejects `effort` outright, so this is not cosmetic — sending
    // the field at all is a 400 rather than a setting the model ignores.
    const calls = captureBody();
    await createAnthropicProvider('k', { effort: null }).translate(
      request,
      'claude-haiku-4-5',
    );
    expect(calls[0]).not.toHaveProperty('output_config');
  });

  it('sends thinking only when asked', async () => {
    const calls = captureBody();
    await createAnthropicProvider('k', {
      effort: null,
      thinking: 'disabled',
    }).translate(request, 'claude-haiku-4-5');
    expect(calls[0]?.thinking).toEqual({ type: 'disabled' });
  });

  it('carries a raised ceiling through', async () => {
    const calls = captureBody();
    await createAnthropicProvider('k', { maxTokens: 16000 }).translate(
      request,
      'claude-sonnet-5',
    );
    expect(calls[0]?.max_tokens).toBe(16000);
  });
});

describe('usage reporting', () => {
  it('reports what the API charged, thinking separately', async () => {
    captureBody();
    const result = await createAnthropicProvider('k').translate(
      request,
      'claude-sonnet-5',
    );

    expect(result.usage).toEqual({
      inputTokens: 11,
      outputTokens: 22,
      thinkingTokens: 3,
    });
  });

  it('still reports usage for a response that returned no text', async () => {
    /*
     * The failure that started all of this: the whole budget spent on thinking
     * and an empty content block. It costs a full request, so leaving it out of
     * the totals would understate what a configuration actually bills.
     */
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          content: [],
          usage: {
            input_tokens: 16806,
            output_tokens: 4096,
            output_tokens_details: { thinking_tokens: 4096 },
          },
        }),
      })),
    );

    const thrown = await createAnthropicProvider('k')
      .translate(request, 'claude-sonnet-5')
      .then(
        () => null,
        (e: unknown) => e as { message: string; usage?: TokenUsage | null },
      );

    expect(thrown?.message).toMatch(/no usable text content block/);
    // Carried on the error rather than reported beside it: the caller that
    // handles the failure is the only one placed to charge for it.
    expect(thrown?.usage?.outputTokens).toBe(4096);
  });
});
