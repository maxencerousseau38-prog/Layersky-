import { describe, expect, it, vi } from 'vitest';
import { configuredProviderNames, pickProvider, translate } from './index.js';
import type { Provider, TranslateRequest } from './types.js';

describe('pickProvider', () => {
  it('is deterministic for the same seed', () => {
    expect(pickProvider('de')).toBe(pickProvider('de'));
  });

  it('distributes across both providers over many seeds', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) seen.add(pickProvider(`seed-${i}`));
    expect(seen).toEqual(new Set(['anthropic', 'openai']));
  });
});

describe('translate', () => {
  it('delegates to the given provider with the given modelId', async () => {
    const fakeProvider: Provider = {
      name: 'anthropic',
      translate: vi.fn(async (_req: TranslateRequest, modelId: string) => ({
        text: `translated-by-${modelId}`,
        usage: null,
      })),
    };
    const result = await translate(
      { systemPrompt: 'sys', userPrompt: 'Paste' },
      fakeProvider,
      'claude-sonnet-5',
    );
    expect(result.text).toBe('translated-by-claude-sonnet-5');
    expect(fakeProvider.translate).toHaveBeenCalledWith(
      { systemPrompt: 'sys', userPrompt: 'Paste' },
      'claude-sonnet-5',
    );
  });
});

describe('provider configuration', () => {
  it('lists only providers that hold a key', () => {
    expect(configuredProviderNames({ ANTHROPIC_API_KEY: 'a' })).toEqual([
      'anthropic',
    ]);
    expect(configuredProviderNames({ OPENAI_API_KEY: 'o' })).toEqual([
      'openai',
    ]);
    expect(
      configuredProviderNames({ ANTHROPIC_API_KEY: 'a', OPENAI_API_KEY: 'o' }),
    ).toEqual(['anthropic', 'openai']);
    expect(configuredProviderNames({})).toEqual([]);
  });

  it('sends every seed to the only configured provider', () => {
    // The production bug: with Anthropic alone configured, the two-way hash
    // still routed about half of all locales to OpenAI, where they died.
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) {
      seen.add(pickProvider(`seed-${i}`, ['anthropic']));
    }
    expect(seen).toEqual(new Set(['anthropic']));
  });

  it('still spreads across both when both are configured', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) {
      seen.add(pickProvider(`seed-${i}`, ['anthropic', 'openai']));
    }
    expect(seen).toEqual(new Set(['anthropic', 'openai']));
  });

  it('stays deterministic for a given seed and provider set', () => {
    expect(pickProvider('de', ['anthropic', 'openai'])).toBe(
      pickProvider('de', ['anthropic', 'openai']),
    );
  });

  it('refuses rather than guessing when nothing is configured', () => {
    expect(() => pickProvider('de', [])).toThrow(/No translation provider/);
  });
});
