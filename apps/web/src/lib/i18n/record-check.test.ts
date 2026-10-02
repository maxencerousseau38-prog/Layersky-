import type { AuditReport, Finding } from '@localize-infra/eval';
import { describe, expect, it } from 'vitest';
import { MAX_CORRECTION_UNITS, planCorrection } from './correct';
import { describeFindings } from './record-check';

/**
 * That the dashboard's "Layersky will fix this" agrees with the correction.
 *
 * This is the one claim on the new surface that can be wrong in a way nobody
 * notices: a page promising a fix the correction then refuses. The guard is
 * that `describeFindings` calls `planCorrection` rather than re-testing
 * `kind === 'missing-translation'`, and these pin the cases where those two
 * answers differ — which is exactly where a hand-written rule would drift.
 */

const report = (findings: Finding[]): AuditReport => ({
  findings,
  keysChecked: 1,
  localesChecked: ['fr', 'de'],
  dynamicCallSites: 0,
  unreferencedSourceKeys: 0,
});

const missing = (key: string, locale: string): Finding => ({
  kind: 'missing-translation',
  key,
  locale,
  detail: `\`${key}\` is missing from \`${locale}\`.`,
});

describe('describeFindings', () => {
  const catalogues = {
    en: { 'app.new': 'Save changes', 'app.old': 'Old' },
    fr: { 'app.old': 'Ancien' },
    de: { 'app.old': 'Alt' },
  };

  it('marks a missing translation the planner would correct', () => {
    const [row] = describeFindings({
      report: report([missing('app.new', 'fr')]),
      catalogues,
      sourceLocale: 'en',
    });

    expect(row?.correctable).toBe(true);
    expect(row?.refusalReason).toBeNull();
    expect(row?.locale).toBe('fr');
    // The audit's own sentence, not a paraphrase.
    expect(row?.detail).toContain('app.new');
  });

  /*
   * The three the planner always leaves alone, each with its own reason —
   * because each has a different remedy and "not corrected automatically" on
   * all three tells a reader nothing they can act on.
   */
  it.each([
    ['placeholder-mismatch' as const, /judgement/i],
    ['icu-invalid' as const, /guessing/i],
    ['missing-source' as const, /inventing product copy/i],
  ])('refuses %s and says why', (kind, expected) => {
    const [row] = describeFindings({
      report: report([
        { kind, key: 'app.old', locale: 'fr', detail: 'something is wrong' },
      ]),
      catalogues,
      sourceLocale: 'en',
    });

    expect(row?.correctable).toBe(false);
    expect(row?.refusalReason).toMatch(expected);
  });

  /*
   * The case a `kind === 'missing-translation'` test in the UI would get
   * wrong. The audit says the key is missing; the source does not actually
   * define it, so the planner leaves it alone — and a dashboard reading only
   * the kind would promise a fix that never arrives.
   */
  it('refuses a missing translation whose source text does not exist', () => {
    const [row] = describeFindings({
      report: report([missing('app.ghost', 'fr')]),
      catalogues,
      sourceLocale: 'en',
    });

    expect(row?.correctable).toBe(false);
    expect(row?.refusalReason).toMatch(/does not define this key/i);
  });

  /*
   * Past the ceiling the planner refuses the whole batch, so no single finding
   * is correctable even though each would be on its own. Reporting them as
   * fixable would promise a correction the next delivery also refuses.
   */
  it('marks nothing correctable when the batch is over the ceiling', () => {
    const many = Array.from({ length: MAX_CORRECTION_UNITS + 1 }, (_, i) =>
      missing(`app.k${i}`, 'fr'),
    );
    const source: Record<string, string> = {};
    for (const f of many) source[f.key] = 'text';

    const rows = describeFindings({
      report: report(many),
      catalogues: { en: source, fr: {} },
      sourceLocale: 'en',
    });

    expect(rows).toHaveLength(MAX_CORRECTION_UNITS + 1);
    expect(rows.every((r) => !r.correctable)).toBe(true);
    expect(rows[0]?.refusalReason).toContain(
      `over the ${MAX_CORRECTION_UNITS}`,
    );
  });

  /*
   * The load-bearing property, stated as an equality rather than as examples:
   * the rows this marks correctable are exactly the units the planner would
   * translate. Not "mostly", and not "the same kinds" — the same pairs.
   */
  it('agrees with planCorrection pair for pair', () => {
    const mixed = report([
      missing('app.new', 'fr'),
      missing('app.new', 'de'),
      missing('app.ghost', 'fr'),
      {
        kind: 'placeholder-mismatch',
        key: 'app.old',
        locale: 'de',
        detail: 'drops {{name}}',
      },
    ]);

    const rows = describeFindings({
      report: mixed,
      catalogues,
      sourceLocale: 'en',
    });
    const plan = planCorrection({
      report: mixed,
      catalogues,
      sourceLocale: 'en',
    });

    const marked = rows
      .filter((r) => r.correctable)
      .map((r) => `${r.locale}:${r.key}`)
      .sort();
    const planned = plan.units.map((u) => `${u.locale}:${u.key}`).sort();

    expect(marked).toEqual(planned);
    expect(marked).toEqual(['de:app.new', 'fr:app.new']);
  });

  it('carries every finding through, correctable or not', () => {
    const rows = describeFindings({
      report: report([
        missing('app.new', 'fr'),
        { kind: 'icu-invalid', key: 'app.old', locale: 'de', detail: 'broken' },
      ]),
      catalogues,
      sourceLocale: 'en',
    });
    // Nothing is dropped: a finding the dashboard does not show is a problem
    // the reviewer does not know about.
    expect(rows).toHaveLength(2);
  });
});
