import { describe, expect, it } from 'vitest';
import {
  type CacheRow,
  cacheableRows,
  splitPending,
  usableCache,
} from './resume';

const row = (over: Partial<CacheRow> = {}): CacheRow => ({
  locale: 'de',
  translation_key: 'checkout.submit',
  source_text: 'Complete your order',
  translated_text: 'Bestellung abschließen',
  ...over,
});

const FRESH = { 'checkout.submit': 'Complete your order' };

describe('usableCache', () => {
  it('keeps a row whose source text still matches', () => {
    const cache = usableCache([row()], FRESH);
    expect(cache.get('de')?.get('checkout.submit')).toBe(
      'Bestellung abschließen',
    );
  });

  /*
   * The correctness argument of the whole feature. A key whose English changed
   * is a different string, and reusing the old translation because the key
   * matched would ship something stale and call it a saving.
   */
  it('drops a row whose source text has changed', () => {
    const cache = usableCache(
      [row({ source_text: 'Place your order' })],
      FRESH,
    );
    expect(cache.size).toBe(0);
  });

  it('drops a row for a key that is no longer extracted', () => {
    const cache = usableCache([row({ translation_key: 'gone' })], FRESH);
    expect(cache.size).toBe(0);
  });

  it('is byte-exact, not trimmed or case-folded', () => {
    for (const drift of [
      'Complete your order ',
      'complete your order',
      'Complete  your order',
    ]) {
      expect(usableCache([row({ source_text: drift })], FRESH).size).toBe(0);
    }
  });

  it('separates locales', () => {
    const cache = usableCache([row(), row({ locale: 'fr' })], FRESH);
    expect([...cache.keys()].sort()).toEqual(['de', 'fr']);
  });

  it('returns an empty cache for no rows, not undefined', () => {
    expect(usableCache([], FRESH).size).toBe(0);
  });
});

describe('splitPending', () => {
  const pending = [{ key: 'a' }, { key: 'b' }, { key: 'c' }];

  it('sends everything when nothing is cached', () => {
    const { toTranslate, fromCache } = splitPending(pending, undefined);
    expect(toTranslate).toHaveLength(3);
    expect(fromCache).toEqual({});
  });

  it('sends only what is not cached', () => {
    const cached = new Map([['b', 'Bé']]);
    const { toTranslate, fromCache } = splitPending(pending, cached);
    expect(toTranslate.map((e) => e.key)).toEqual(['a', 'c']);
    expect(fromCache).toEqual({ b: 'Bé' });
  });

  /*
   * The billing property. `toTranslate` is what the quota is charged for, so a
   * fully cached locale must charge nothing — otherwise a resumed run bills a
   * second time for a translation the customer already paid for.
   */
  it('sends nothing when every pending key is cached', () => {
    const cached = new Map([
      ['a', 'A'],
      ['b', 'B'],
      ['c', 'C'],
    ]);
    const { toTranslate, fromCache } = splitPending(pending, cached);
    expect(toTranslate).toEqual([]);
    expect(Object.keys(fromCache)).toHaveLength(3);
  });

  /*
   * The delivery property. Recovered keys must reach the merge, or a resumed
   * run would commit a file missing exactly what it resumed to keep.
   */
  it('together, the two halves account for every pending key', () => {
    const cached = new Map([['b', 'Bé']]);
    const { toTranslate, fromCache } = splitPending(pending, cached);
    const covered = [
      ...toTranslate.map((e) => e.key),
      ...Object.keys(fromCache),
    ];
    expect(covered.sort()).toEqual(['a', 'b', 'c']);
  });

  it('ignores a cached key that is not pending', () => {
    const cached = new Map([['zzz', 'Z']]);
    const { toTranslate, fromCache } = splitPending(pending, cached);
    expect(toTranslate).toHaveLength(3);
    expect(fromCache).toEqual({});
  });

  it('treats an empty cache map as no cache at all', () => {
    const { toTranslate } = splitPending(pending, new Map());
    expect(toTranslate).toHaveLength(3);
  });
});

describe('cacheableRows', () => {
  const confident = {
    key: 'checkout.submit',
    text: 'Bestellung abschließen',
    confidence: 'confident' as const,
  };
  const ambiguous = {
    key: 'greeting',
    text: 'Willkommen zurück',
    confidence: 'ambiguous' as const,
  };
  const fresh = { ...FRESH, greeting: 'Welcome back' };

  it('banks a confident translation with the source text it answered', () => {
    expect(cacheableRows([confident], fresh)).toEqual([
      {
        translation_key: 'checkout.submit',
        source_text: 'Complete your order',
        translated_text: 'Bestellung abschließen',
      },
    ]);
  });

  /*
   * Invariant 4. The cache keeps no confidence and no question, and escalations
   * are raised only from a fresh model response. A run cut off after banking an
   * ambiguous proposal would hand it to the next click as an ordinary hit, and
   * that click would commit it with nobody having answered the question.
   * Re-buying the key is the price of asking again.
   */
  it('never banks an ambiguous translation', () => {
    expect(cacheableRows([confident, ambiguous], fresh)).toEqual([
      expect.objectContaining({ translation_key: 'checkout.submit' }),
    ]);
  });

  /*
   * A row with an empty source text can never be a hit — `usableCache` compares
   * against the freshly extracted text — so writing it only spends a row.
   */
  it('does not bank a key with no extracted source text', () => {
    expect(cacheableRows([{ ...confident, key: 'gone' }], fresh)).toEqual([]);
  });
});
