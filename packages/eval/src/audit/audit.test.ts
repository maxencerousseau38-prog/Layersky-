import { describe, expect, it } from 'vitest';
import { type AuditInput, auditI18n, auditPasses } from './index.js';

const base = (over: Partial<AuditInput> = {}): AuditInput => ({
  usedKeys: ['checkout.submit'],
  sourceLocale: 'en',
  catalogues: {
    en: { 'checkout.submit': 'Complete your order' },
    fr: { 'checkout.submit': 'Finaliser la commande' },
  },
  ...over,
});

describe('auditI18n', () => {
  it('passes a catalogue with nothing wrong', () => {
    const report = auditI18n(base());
    expect(report.findings).toEqual([]);
    expect(auditPasses(report)).toBe(true);
    expect(report.keysChecked).toBe(1);
    expect(report.localesChecked).toEqual(['fr']);
  });

  it('reports a key the source does not define', () => {
    const report = auditI18n(base({ usedKeys: ['checkout.submit', 'ghost'] }));
    const finding = report.findings.find((f) => f.key === 'ghost');
    expect(finding?.kind).toBe('missing-source');
    expect(finding?.locale).toBeUndefined();
  });

  /*
   * One mistake, one finding. Reporting an undefined source key again for every
   * target would turn a single typo into one line per language — the noise the
   * run pipeline already avoids by re-raising a quota refusal rather than
   * isolating it per locale.
   */
  it('reports an undefined source key once, not once per locale', () => {
    const report = auditI18n(
      base({
        usedKeys: ['ghost'],
        catalogues: { en: {}, fr: {}, de: {}, ja: {} },
      }),
    );
    expect(report.findings).toHaveLength(1);
  });

  it('reports a locale missing a translation', () => {
    const report = auditI18n(
      base({
        catalogues: {
          en: { 'checkout.submit': 'Complete your order' },
          fr: {},
        },
      }),
    );
    expect(report.findings[0]?.kind).toBe('missing-translation');
    expect(report.findings[0]?.locale).toBe('fr');
  });

  describe('placeholders', () => {
    const withCount = (fr: string): AuditInput =>
      base({
        usedKeys: ['cart.count'],
        catalogues: {
          en: { 'cart.count': 'You have {{count}} items' },
          fr: { 'cart.count': fr },
        },
      });

    it('passes when the placeholder survives', () => {
      expect(
        auditI18n(withCount('Vous avez {{count}} articles')).findings,
      ).toEqual([]);
    });

    it('reports a dropped placeholder, and names it', () => {
      const report = auditI18n(withCount('Vous avez des articles'));
      expect(report.findings[0]?.kind).toBe('placeholder-mismatch');
      expect(report.findings[0]?.detail).toContain('drops {{count}}');
    });

    it('reports an invented placeholder, and names it', () => {
      const report = auditI18n(
        withCount('Vous avez {{count}} articles pour {{user}}'),
      );
      expect(report.findings[0]?.detail).toContain('adds {{user}}');
    });

    /*
     * The failure a boolean cannot express. `placeholdersIntact` would answer
     * false here and leave the reader to diff two strings by eye; a check has
     * to say which token moved.
     */
    it('reports both halves of a swap', () => {
      const report = auditI18n(
        base({
          usedKeys: ['greet'],
          catalogues: {
            en: { greet: 'Hello {{name}}' },
            fr: { greet: 'Bonjour {{nom}}' },
          },
        }),
      );
      expect(report.findings[0]?.detail).toContain('drops {{name}}');
      expect(report.findings[0]?.detail).toContain('adds {{nom}}');
    });
  });

  describe('ICU', () => {
    it('reports a translation that stops parsing as ICU', () => {
      const report = auditI18n(
        base({
          usedKeys: ['items'],
          catalogues: {
            en: { items: '{count, plural, one {# item} other {# items}}' },
            fr: { items: '{count, plural, one {# article' },
          },
        }),
      );
      expect(report.findings.some((f) => f.kind === 'icu-invalid')).toBe(true);
    });

    /*
     * Only when the source is ICU. A plain string whose translation needed a
     * plural form is a judgement call, and this audit does not make those —
     * the same line /quality draws when it prints "No data" rather than a
     * percentage for a check with no applicable input.
     */
    it('says nothing about ICU when the source is not an ICU message', () => {
      const report = auditI18n(
        base({
          usedKeys: ['plain'],
          catalogues: {
            en: { plain: 'Hello' },
            fr: { plain: 'Bonjour {count, plural,' },
          },
        }),
      );
      expect(report.findings.some((f) => f.kind === 'icu-invalid')).toBe(false);
    });
  });

  /*
   * Counted, never failed on. A key with no call site among the *changed* files
   * is the normal state of every key the pull request did not touch; failing on
   * it would be wrong on the first run and would train the reader to ignore the
   * check.
   */
  it('counts unreferenced source keys without making them findings', () => {
    const report = auditI18n(
      base({
        usedKeys: ['checkout.submit'],
        catalogues: {
          en: { 'checkout.submit': 'Complete your order', other: 'Other' },
          fr: { 'checkout.submit': 'Finaliser la commande', other: 'Autre' },
        },
      }),
    );
    expect(report.unreferencedSourceKeys).toBe(1);
    expect(report.findings).toEqual([]);
  });

  it('carries the dynamic call count into the report', () => {
    expect(auditI18n(base({ dynamicCallSites: 4 })).dynamicCallSites).toBe(4);
  });

  it('passes an empty pull request rather than failing it', () => {
    const report = auditI18n(base({ usedKeys: [] }));
    expect(auditPasses(report)).toBe(true);
    expect(report.keysChecked).toBe(0);
  });
});
