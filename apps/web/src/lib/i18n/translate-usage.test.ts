import { afterEach, describe, expect, it, vi } from 'vitest';
import { translateBatch } from './correct-github';

/**
 * What `translateBatch` reads back out of `/v1/translate`.
 *
 * The rest of `correct-github.ts` is network and is deliberately untested —
 * this is the one part of it that is a decision rather than a call, and it is
 * the seam a cost figure travels through. Three cases, and the third is the
 * one that would silently lie.
 */
afterEach(() => {
  vi.restoreAllMocks();
});

const ok = (body: unknown) => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => body,
    })),
  );
};

const call = () =>
  translateBatch({ apiUrl: 'https://api.test', apiToken: 't' })({
    targetLocale: 'de',
    strings: [{ key: 'a', text: 'Save' }],
  });

describe('translateBatch usage', () => {
  it('carries what the route reported', async () => {
    ok({
      translations: [{ key: 'a', text: 'Speichern' }],
      missingKeys: [],
      failures: [],
      usage: {
        requests: 1,
        inputTokens: 311,
        outputTokens: 42,
        thinkingTokens: 7,
      },
    });

    expect((await call()).usage).toEqual({
      requests: 1,
      inputTokens: 311,
      outputTokens: 42,
      thinkingTokens: 7,
    });
  });

  /*
   * An `apps/api` deployed before this field existed answers without it. Null,
   * not zero: reading "absent" as "free" would record a real cost as nothing,
   * which is worse than recording nothing, because nothing is visibly missing.
   * `apps/api` is not wired to Git and is deployed by hand, so the two halves
   * of this product genuinely do run at different versions.
   */
  it('reports null rather than zero when the route says nothing', async () => {
    ok({
      translations: [{ key: 'a', text: 'Speichern' }],
      missingKeys: [],
      failures: [],
    });
    expect((await call()).usage).toBeNull();
  });

  it('carries the tally off a failed request', async () => {
    const body = JSON.stringify({
      error: 'The translation provider failed for this request.',
      usage: {
        requests: 3,
        inputTokens: 900,
        outputTokens: 0,
        thinkingTokens: 0,
      },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 502,
        statusText: 'Bad Gateway',
        text: async () => body,
      })),
    );

    const thrown = await call().then(
      () => null,
      (e: unknown) => e as { usage?: unknown },
    );
    expect(thrown?.usage).toEqual({
      requests: 3,
      inputTokens: 900,
      outputTokens: 0,
      thinkingTokens: 0,
    });
  });
});
