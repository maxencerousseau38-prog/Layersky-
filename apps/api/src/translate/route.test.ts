import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Provider } from '../router/types.js';
import { translateRouteHandler } from './route.js';
afterEach(() => {
  vi.restoreAllMocks();
});

function fakeProvider(
  name: 'anthropic' | 'openai',
  responseText: string,
): Provider {
  return { name, translate: vi.fn(async () => reply(responseText)) };
}

/**
 * A provider reply carrying no usage. These tests measure behaviour, and a
 * provider that reports nothing is a real case: `usage` is nullable precisely
 * so "reported nothing" and "used nothing" stay distinguishable.
 */
const reply = (text: string) => ({ text, usage: null });

const providers = {
  anthropic: fakeProvider('anthropic', '[{"key":"a","text":"Willkommen"}]'),
  openai: fakeProvider('openai', '[{"key":"a","text":"Willkommen"}]'),
};
const modelIds = { anthropic: 'claude-sonnet-5', openai: 'gpt-4o' };

describe('translateRouteHandler', () => {
  it('returns 200 with translations for a valid request', async () => {
    const body = {
      targetLocale: 'de',
      strings: [
        {
          key: 'a',
          text: 'Welcome',
          filePath: 'x.tsx',
          componentName: null,
          surroundingCode: '',
        },
      ],
    };
    const result = await translateRouteHandler(body, providers, modelIds);
    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      translations: [
        {
          key: 'a',
          text: 'Willkommen',
          confidence: 'confident',
          question: null,
          alternatives: [],
        },
      ],
      missingKeys: [],
      // Empty rather than absent: `failures` distinguishes "the model left a
      // key out" from "every attempt at that chunk came back unparseable", and
      // a clean batch says so explicitly.
      failures: [],
      // Defaulted by the schema, because the fake provider reports nothing.
      // A real one reports per call, and this is the field a workspace's cost
      // is recorded from.
      usage: {
        requests: 1,
        inputTokens: 0,
        outputTokens: 0,
        thinkingTokens: 0,
      },
    });
  });

  it('returns 400 for a request body that fails schema validation', async () => {
    const result = await translateRouteHandler(
      { targetLocale: 'de', strings: [] },
      providers,
      modelIds,
    );
    expect(result.status).toBe(400);
  });

  it('returns 502 when the provider throws', async () => {
    const failingProviders = {
      anthropic: {
        name: 'anthropic' as const,
        translate: vi.fn(async () => {
          throw new Error('rate limited');
        }),
      },
      openai: providers.openai,
    };
    const body = {
      targetLocale: 'de',
      strings: [
        {
          key: 'a',
          text: 'Welcome',
          filePath: 'x.tsx',
          componentName: null,
          surroundingCode: '',
        },
      ],
    };
    // Force the 'de' seed to route to anthropic deterministically isn't guaranteed; instead
    // exercise both providers failing to make the test provider-independent.
    const bothFail = {
      anthropic: failingProviders.anthropic,
      openai: {
        name: 'openai' as const,
        translate: vi.fn(async () => {
          throw new Error('rate limited');
        }),
      },
    };
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await translateRouteHandler(body, bothFail, modelIds);
    expect(result.status).toBe(502);
  });

  /*
   * Found by running the packed CLI against a local API whose shell carried an
   * invalid OPENAI_API_KEY: the CLI printed OpenAI's own 401 body, which quotes
   * the key's first and last characters.
   */
  it('never returns the provider error to the caller', async () => {
    const providerBody =
      'OpenAI API error 401: {"error":{"message":"Incorrect API key provided: sk-abcd***wxyz"}}';
    const leaking = {
      anthropic: {
        name: 'anthropic' as const,
        translate: vi.fn(async () => {
          throw new Error(providerBody);
        }),
      },
      openai: {
        name: 'openai' as const,
        translate: vi.fn(async () => {
          throw new Error(providerBody);
        }),
      },
    };
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await translateRouteHandler(
      {
        targetLocale: 'de',
        strings: [
          {
            key: 'a',
            text: 'Welcome',
            filePath: 'x.tsx',
            componentName: null,
            surroundingCode: '',
          },
        ],
      },
      leaking,
      modelIds,
    );
    expect(result.status).toBe(502);
    const returned = JSON.stringify(result.body);
    expect(returned).not.toContain('sk-');
    expect(returned).not.toContain('OpenAI API error');
    expect(logged).toHaveBeenCalled();
  });
});
