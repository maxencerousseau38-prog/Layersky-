import type { TranslateBatchRequest } from '@localize-infra/schemas';
import { describe, expect, it, vi } from 'vitest';
import type { Provider } from '../router/types.js';
import { MAX_STRINGS_PER_REQUEST, handleTranslateBatch } from './handler.js';

const request: TranslateBatchRequest = {
  targetLocale: 'de',
  strings: [
    {
      key: 'a',
      text: 'Welcome',
      filePath: 'x.tsx',
      componentName: null,
      surroundingCode: '',
    },
    {
      key: 'b',
      text: 'Cancel',
      filePath: 'x.tsx',
      componentName: null,
      surroundingCode: '',
    },
  ],
};

/**
 * A provider reply carrying no usage. These tests measure behaviour, and a
 * provider that reports nothing is a real case: `usage` is nullable precisely
 * so "reported nothing" and "used nothing" stay distinguishable.
 */
const reply = (text: string) => ({ text, usage: null });

function fakeProvider(responseText: string): Provider {
  return {
    name: 'anthropic',
    translate: vi.fn(async () => reply(responseText)),
  };
}

describe('handleTranslateBatch', () => {
  it('returns translations for every requested key when the model responds completely', async () => {
    const provider = fakeProvider(
      '[{"key":"a","text":"Willkommen"},{"key":"b","text":"Abbrechen"}]',
    );
    const result = await handleTranslateBatch(
      request,
      provider,
      'claude-sonnet-5',
    );
    expect(result.translations).toEqual([
      {
        key: 'a',
        text: 'Willkommen',
        confidence: 'confident',
        question: null,
        alternatives: [],
      },
      {
        key: 'b',
        text: 'Abbrechen',
        confidence: 'confident',
        question: null,
        alternatives: [],
      },
    ]);
    expect(result.missingKeys).toEqual([]);
  });

  it('reports missingKeys for requested strings the model did not translate, without throwing', async () => {
    const provider = fakeProvider('[{"key":"a","text":"Willkommen"}]');
    const result = await handleTranslateBatch(
      request,
      provider,
      'claude-sonnet-5',
    );
    expect(result.translations).toEqual([
      {
        key: 'a',
        text: 'Willkommen',
        confidence: 'confident',
        question: null,
        alternatives: [],
      },
    ]);
    expect(result.missingKeys).toEqual(['b']);
  });
});

/**
 * Chunking, and the failure that made it necessary.
 *
 * The pipeline sent every pending string for a locale in one request. Measured
 * on 2026-08-21 against the configured model: at 20 strings it answered; at 40
 * and at 80 it spent the whole 4096-token budget on adaptive thinking and
 * returned an empty content block. Not a truncated answer — no answer.
 *
 * `docs/product/09-unit-economics.md` records the measurements. The consequence
 * was that no customer could be onboarded at all: the smallest modelled
 * customer, a 120-string side project, already exceeded it.
 */
function countingProvider(perCall: (strings: string[]) => string): {
  provider: Provider;
  calls: string[][];
} {
  const calls: string[][] = [];
  return {
    calls,
    provider: {
      name: 'anthropic',
      translate: vi.fn(async (req) => {
        const items = JSON.parse(req.userPrompt) as { key: string }[];
        const keys = items.map((i) => i.key);
        calls.push(keys);
        return reply(perCall(keys));
      }),
    },
  };
}

const answerAll = (keys: string[]) =>
  JSON.stringify(keys.map((key) => ({ key, text: `${key}-de` })));

function manyStrings(n: number): TranslateBatchRequest {
  return {
    targetLocale: 'de',
    strings: Array.from({ length: n }, (_, i) => ({
      key: `k${i}`,
      text: `Text ${i}`,
      filePath: 'x.tsx',
      componentName: null,
      surroundingCode: '',
    })),
  };
}

describe('handleTranslateBatch, over more strings than one request can answer', () => {
  it('splits the work instead of sending one oversized request', async () => {
    const { provider, calls } = countingProvider(answerAll);
    const result = await handleTranslateBatch(
      manyStrings(250),
      provider,
      'claude-sonnet-5',
    );

    expect(calls.length).toBeGreaterThan(1);
    for (const call of calls) {
      expect(call.length).toBeLessThanOrEqual(MAX_STRINGS_PER_REQUEST);
    }
    expect(result.translations).toHaveLength(250);
    expect(result.missingKeys).toEqual([]);
  });

  it('sends every string exactly once, in order, across the chunks', async () => {
    const { provider, calls } = countingProvider(answerAll);
    const request = manyStrings(250);
    await handleTranslateBatch(request, provider, 'claude-sonnet-5');

    // A chunking bug that drops or duplicates a string would still produce a
    // plausible-looking response, so this is asserted rather than assumed.
    expect(calls.flat()).toEqual(request.strings.map((s) => s.key));
  });

  it('still makes one request when the work fits', async () => {
    const { provider, calls } = countingProvider(answerAll);
    await handleTranslateBatch(manyStrings(10), provider, 'claude-sonnet-5');
    expect(calls).toHaveLength(1);
  });

  it('recovers a chunk that failed once, instead of losing it', async () => {
    /*
     * This asserted the opposite until the retry existed: that one thrown
     * chunk left its strings permanently missing, and only checked that the
     * *other* chunks survived. That was the honest description of a pipeline
     * with no second attempt, and it is what
     * `docs/product/10-model-benchmark.md` measured costing a whole locale.
     *
     * The property worth keeping from it is still asserted: a chunk failing
     * does not discard the ones that already succeeded. What changed is that
     * the failed chunk now comes back.
     */
    let call = 0;
    const provider: Provider = {
      name: 'anthropic',
      translate: vi.fn(async (req) => {
        const items = JSON.parse(req.userPrompt) as { key: string }[];
        call += 1;
        if (call === 2) throw new Error('provider exploded');
        return reply(answerAll(items.map((i) => i.key)));
      }),
    };

    const request = manyStrings(250);
    const result = await handleTranslateBatch(
      request,
      provider,
      'claude-sonnet-5',
      { sleep: async () => {} },
    );

    expect(result.translations).toHaveLength(250);
    expect(result.missingKeys).toEqual([]);
    expect(result.failures).toEqual([]);
  });

  it('fails rather than reporting a batch where nothing worked as partial', async () => {
    /*
     * This first asserted the opposite — no translations and every key
     * missing — and it was wrong. A batch where every chunk failed is a
     * provider outage, and answering 200 with an empty array makes it
     * indistinguishable from a model that simply returned nothing. The route
     * turns this error into a 502, and that contract has its own test.
     */
    const provider: Provider = {
      name: 'anthropic',
      translate: vi.fn(async () => {
        throw new Error('Anthropic response had no usable text content block');
      }),
    };

    await expect(
      handleTranslateBatch(manyStrings(10), provider, 'claude-sonnet-5'),
    ).rejects.toThrow(/no usable text content block/);
  });

  it('is partial, not failed, when some chunks worked', async () => {
    // The distinction the two tests above draw between them: any successful
    // chunk makes the batch a partial result rather than an error.
    let call = 0;
    const provider: Provider = {
      name: 'anthropic',
      translate: vi.fn(async (req) => {
        const items = JSON.parse(req.userPrompt) as { key: string }[];
        call += 1;
        if (call > 1) throw new Error('rate limited');
        return reply(answerAll(items.map((i) => i.key)));
      }),
    };

    const result = await handleTranslateBatch(
      manyStrings(250),
      provider,
      'claude-sonnet-5',
    );
    expect(result.translations).toHaveLength(MAX_STRINGS_PER_REQUEST);
    expect(result.missingKeys).toHaveLength(250 - MAX_STRINGS_PER_REQUEST);
  });
});
