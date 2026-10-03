import type { TranslateBatchRequest } from '@localize-infra/schemas';
import { describe, expect, it, vi } from 'vitest';
import type { Provider } from '../router/types.js';
import { handleTranslateBatch } from './handler.js';

/**
 * Every failure mode the benchmark actually observed, as a regression test.
 *
 * These are not hypotheticals. Each error string below was produced by a real
 * model against this repository's own prompt and corpus while running
 * `apps/api/eval/run.ts` and `apps/api/eval/robustness.ts`; the counts are in
 * `docs/product/10-model-benchmark.md`. Before the retry each of them cost
 * every string in its chunk, silently, in a run that still opened a pull
 * request for the locales that happened to work.
 */

/** Never sleeps. Records what the backoff would have waited. */
function fakeClock() {
  const waits: number[] = [];
  return {
    waits,
    sleep: async (ms: number) => {
      waits.push(ms);
    },
  };
}

/**
 * A provider reply carrying no usage. These tests measure behaviour, and a
 * provider that reports nothing is a real case: `usage` is nullable precisely
 * so "reported nothing" and "used nothing" stay distinguishable.
 */
const reply = (text: string) => ({ text, usage: null });

function request(n: number): TranslateBatchRequest {
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

/** Answers every key it was asked for. */
function answerAll(userPrompt: string): string {
  const items = JSON.parse(userPrompt) as { key: string }[];
  return JSON.stringify(items.map(({ key }) => ({ key, text: `${key}-de` })));
}

const ALL = '__ALL__';

/** A provider that plays a fixed script, one entry per call. */
function scripted(script: (Error | string)[]): {
  provider: Provider;
  seen: string[][];
} {
  let call = 0;
  const seen: string[][] = [];
  return {
    seen,
    provider: {
      name: 'anthropic',
      translate: vi.fn(async (req) => {
        seen.push(
          (JSON.parse(req.userPrompt) as { key: string }[]).map((i) => i.key),
        );
        const step = script[Math.min(call, script.length - 1)];
        call += 1;
        if (step instanceof Error) throw step;
        return reply(
          step === ALL ? answerAll(req.userPrompt) : (step as string),
        );
      }),
    },
  };
}

/**
 * The exact messages seen in the benchmark. Three come from
 * `parseTranslationResponse`, one from the Anthropic provider itself.
 */
const OBSERVED: [string, Error][] = [
  // Haiku 4.5, stop_reason end_turn: finished and emitted invalid JSON.
  [
    'malformed JSON at end_turn',
    new Error(
      "Expected ',' or '}' after property value in JSON at position 2866",
    ),
  ],
  // Sonnet 5 default reasoning, stop_reason max_tokens: cut off mid-string.
  [
    'truncated JSON at max_tokens',
    new Error('Unterminated string in JSON at position 2453'),
  ],
  // Output that carried no array at all.
  [
    'no array in the response',
    new Error('No JSON array found in model response'),
  ],
  // The whole budget spent thinking; empty content block.
  [
    'empty content block',
    new Error('Anthropic response had no usable text content block'),
  ],
  // Not from the benchmark, but the one every provider eventually returns.
  ['a rate limit', new Error('Anthropic API error 429: rate limited')],
];

describe.each(OBSERVED)('recovers from %s', (_label, error) => {
  it('retries and returns every string', async () => {
    const clock = fakeClock();
    const { provider, seen } = scripted([error, ALL]);

    const result = await handleTranslateBatch(
      request(10),
      provider,
      'claude-sonnet-5',
      { sleep: clock.sleep },
    );

    expect(result.translations).toHaveLength(10);
    expect(result.missingKeys).toEqual([]);
    expect(result.failures).toEqual([]);
    // The retry asked for the same keys, not a subset or a superset.
    expect(seen).toHaveLength(2);
    expect(seen[1]).toEqual(seen[0]);
    expect(clock.waits).toHaveLength(1);
  });
});

describe('bounded retries', () => {
  it('stops after the attempt limit rather than retrying forever', async () => {
    const clock = fakeClock();
    const { provider } = scripted([new Error('always broken')]);

    await expect(
      handleTranslateBatch(request(10), provider, 'claude-sonnet-5', {
        sleep: clock.sleep,
      }),
    ).rejects.toThrow(/always broken/);

    // Three attempts, so two waits between them.
    expect(provider.translate).toHaveBeenCalledTimes(3);
    expect(clock.waits).toHaveLength(2);
  });

  it('honours a caller-supplied attempt limit', async () => {
    const clock = fakeClock();
    const { provider } = scripted([new Error('always broken')]);

    await expect(
      handleTranslateBatch(request(10), provider, 'claude-sonnet-5', {
        sleep: clock.sleep,
        maxAttempts: 1,
      }),
    ).rejects.toThrow();
    expect(provider.translate).toHaveBeenCalledTimes(1);
    expect(clock.waits).toHaveLength(0);
  });
});

describe('exponential backoff', () => {
  it('waits longer after each failure', async () => {
    const clock = fakeClock();
    const { provider } = scripted([new Error('one'), new Error('two'), ALL]);

    await handleTranslateBatch(request(5), provider, 'claude-sonnet-5', {
      sleep: clock.sleep,
    });

    expect(clock.waits).toHaveLength(2);
    expect(clock.waits[1]).toBeGreaterThan(clock.waits[0] ?? 0);
  });

  it('jitters, so chunks that failed together do not retry in lockstep', async () => {
    // Without jitter every chunk that failed together retries together, which
    // is the shape that earns a second rate limit on the way back in.
    const seen = new Set<number>();
    for (let i = 0; i < 12; i += 1) {
      const clock = fakeClock();
      const { provider } = scripted([new Error('x'), ALL]);
      await handleTranslateBatch(request(3), provider, 'claude-sonnet-5', {
        sleep: clock.sleep,
      });
      seen.add(clock.waits[0] ?? 0);
    }
    expect(seen.size).toBeGreaterThan(1);
  });
});

describe('no duplicate or corrupt translations', () => {
  it('never returns a key twice when a retry re-answers it', async () => {
    /*
     * The dangerous shape. A chunk answers half its keys, the retry answers
     * all of them, and a naive concatenation returns the first half twice —
     * two different translations for one key, both looking valid, and whichever
     * `Object.fromEntries` saw last wins silently downstream.
     */
    const clock = fakeClock();
    const half = JSON.stringify(
      Array.from({ length: 5 }, (_, i) => ({ key: `k${i}`, text: 'first' })),
    );
    const { provider, seen } = scripted([half, ALL]);

    const result = await handleTranslateBatch(
      request(10),
      provider,
      'claude-sonnet-5',
      { sleep: clock.sleep },
    );

    const keys = result.translations.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(result.translations).toHaveLength(10);

    // The retry asked only for what was still missing.
    expect(seen[1]).toEqual(['k5', 'k6', 'k7', 'k8', 'k9']);

    // The first answer wins; a retry does not overwrite an accepted key.
    expect(result.translations.find((t) => t.key === 'k0')?.text).toBe('first');
  });

  it('rejects a translation for a key nobody asked for', async () => {
    // A hallucinated key would reach `record_run_translations` as a proposal —
    // or an escalation — for a string that does not exist in the repository.
    const clock = fakeClock();
    const withGhost = JSON.stringify([
      { key: 'k0', text: 'real' },
      { key: 'not-requested', text: 'ghost' },
    ]);
    const { provider } = scripted([withGhost, ALL]);

    const result = await handleTranslateBatch(
      request(2),
      provider,
      'claude-sonnet-5',
      { sleep: clock.sleep },
    );

    expect(result.translations.map((t) => t.key).sort()).toEqual(['k0', 'k1']);
  });
});

describe('clear failure states', () => {
  it('reports which keys were lost, after how many attempts, and why', async () => {
    const clock = fakeClock();
    // Chunk one succeeds; chunk two never does.
    let call = 0;
    const provider: Provider = {
      name: 'anthropic',
      translate: vi.fn(async (req) => {
        call += 1;
        if (call === 1) return reply(answerAll(req.userPrompt));
        throw new Error('Unterminated string in JSON at position 2453');
      }),
    };

    const result = await handleTranslateBatch(
      request(150),
      provider,
      'claude-sonnet-5',
      { sleep: clock.sleep },
    );

    expect(result.translations).toHaveLength(100);
    expect(result.missingKeys).toHaveLength(50);
    expect(result.failures).toHaveLength(1);
    expect(result.failures?.[0]?.attempts).toBe(3);
    expect(result.failures?.[0]?.keys).toHaveLength(50);
    // Verbatim, so a customer comparing against their own logs sees the same
    // string (DESIGN.md §8).
    expect(result.failures?.[0]?.error).toMatch(/Unterminated string/);
  });

  it('still throws when every chunk failed, so an outage is not a partial run', async () => {
    const clock = fakeClock();
    const { provider } = scripted([new Error('Anthropic API error 503')]);

    await expect(
      handleTranslateBatch(request(150), provider, 'claude-sonnet-5', {
        sleep: clock.sleep,
      }),
    ).rejects.toThrow(/503/);
  });

  it('reports a model that simply omits a key, without calling it an error', async () => {
    // Not a failure to retry away: the model answered, and left one out. After
    // the attempts are spent it is a missing key with no failure record.
    const clock = fakeClock();
    const short = JSON.stringify([{ key: 'k0', text: 'a' }]);
    const { provider } = scripted([short]);

    const result = await handleTranslateBatch(
      request(2),
      provider,
      'claude-sonnet-5',
      { sleep: clock.sleep },
    );

    expect(result.missingKeys).toEqual(['k1']);
    expect(result.failures).toEqual([]);
  });
});
