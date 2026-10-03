import type { TranslatableString } from '@localize-infra/schemas';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { translateBatch } from './translate-client.js';

const strings: TranslatableString[] = [
  {
    key: 'a',
    text: 'Welcome',
    filePath: 'x.tsx',
    componentName: null,
    surroundingCode: '',
  },
];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('translateBatch', () => {
  it('POSTs to <apiUrl>/v1/translate and returns the parsed response', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => ({
      ok: true,
      json: async () => ({
        translations: [{ key: 'a', text: 'Willkommen' }],
        missingKeys: [],
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await translateBatch(
      'http://localhost:8787',
      'de',
      strings,
      'test-token',
    );

    // The response schema now carries confidence, and fills it in when a
    // provider answers in the older two-field shape. Asserting the defaulted
    // form on purpose: a model that says nothing about its confidence is read
    // as sure of itself, which is what keeps an old provider from crashing a
    // batch — and is exactly the behaviour worth pinning, because the same
    // default is what would silently produce zero escalations if a provider
    // started dropping the field.
    expect(result).toEqual({
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
      // The API response above carries no `failures` field at all. It arrives
      // defaulted, which is the compatibility contract: a server that predates
      // the field and a client that knows about it still agree. `usage` is the
      // same contract one field later — and it matters more here than
      // anywhere, because a self-hosted `apps/api` is pinned by whoever
      // installed it, not by this repository.
      failures: [],
      usage: {
        requests: 0,
        inputTokens: 0,
        outputTokens: 0,
        thinkingTokens: 0,
      },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8787/v1/translate',
      expect.objectContaining({ method: 'POST' }),
    );
    const call = fetchMock.mock.calls[0];
    if (!call) {
      throw new Error('fetch was not called');
    }
    const [, init] = call;
    expect(JSON.parse(init.body as string)).toEqual({
      targetLocale: 'de',
      strings,
    });
  });

  it('sends the api token as a Bearer Authorization header', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => ({
      ok: true,
      json: async () => ({ translations: [], missingKeys: [] }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    await translateBatch(
      'http://localhost:8787',
      'de',
      strings,
      'secret-token',
    );

    const call = fetchMock.mock.calls[0];
    if (!call) {
      throw new Error('fetch was not called');
    }
    const [, init] = call;
    expect((init.headers as Record<string, string>).authorization).toBe(
      'Bearer secret-token',
    );
  });

  it('throws a clear error including the status and body when the API responds with an error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 502,
        text: async () => 'upstream provider failed',
      })),
    );
    await expect(
      translateBatch('http://localhost:8787', 'de', strings, 'test-token'),
    ).rejects.toThrow(
      'Translation API request failed: upstream provider failed (HTTP 502)',
    );
  });
});
