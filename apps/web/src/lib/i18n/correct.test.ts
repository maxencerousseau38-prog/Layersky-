import type { AuditReport, Finding } from '@localize-infra/eval';
import { describe, expect, it } from 'vitest';
import { detectIndent, insertKeys, splitKey } from './catalogue-file';
import {
  MAX_CORRECTION_UNITS,
  applyTranslations,
  correctableDirectory,
  planCorrection,
} from './correct';
import { buildCorrection, correctionBody } from './correct-run';

/**
 * The correction, tested where the damage would be done.
 *
 * Two properties carry the whole feature and both are about what it refuses:
 * it may only add what is absent, and it may only commit what the audit
 * accepts. Everything else — which locale, which file — is mechanics that
 * fails loudly. These do not.
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

describe('planCorrection', () => {
  const catalogues = {
    en: { 'app.new': 'Save changes', 'app.old': 'Old' },
    fr: { 'app.old': 'Ancien' },
    de: { 'app.old': 'Alt' },
  };

  it('plans one unit per missing locale, carrying the source text', () => {
    const plan = planCorrection({
      report: report([missing('app.new', 'fr'), missing('app.new', 'de')]),
      catalogues,
      sourceLocale: 'en',
    });
    expect(plan.refusal).toBeNull();
    expect(plan.locales).toEqual(['de', 'fr']);
    expect(plan.units).toEqual([
      { locale: 'fr', key: 'app.new', sourceText: 'Save changes' },
      { locale: 'de', key: 'app.new', sourceText: 'Save changes' },
    ]);
  });

  /*
   * The refusals are the feature. A placeholder mismatch means an existing
   * translation disagrees with its source, and which is wrong is a judgement;
   * "fixing" it would overwrite somebody's work to turn a check green.
   */
  it.each([
    ['placeholder-mismatch' as const],
    ['icu-invalid' as const],
    ['missing-source' as const],
  ])('leaves %s alone', (kind) => {
    const plan = planCorrection({
      report: report([
        { kind, key: 'app.old', locale: 'fr', detail: 'something is wrong' },
      ]),
      catalogues,
      sourceLocale: 'en',
    });
    expect(plan.units).toEqual([]);
    expect(plan.leftAlone).toHaveLength(1);
    expect(plan.refusal).toMatch(/safe to correct automatically/i);
  });

  it('corrects the missing translations and still reports the rest', () => {
    const plan = planCorrection({
      report: report([
        missing('app.new', 'fr'),
        {
          kind: 'placeholder-mismatch',
          key: 'app.old',
          locale: 'de',
          detail: 'drops {{name}}',
        },
      ]),
      catalogues,
      sourceLocale: 'en',
    });
    expect(plan.units).toHaveLength(1);
    expect(plan.leftAlone).toHaveLength(1);
  });

  it('refuses a key the source does not actually define', () => {
    const plan = planCorrection({
      report: report([missing('app.ghost', 'fr')]),
      catalogues,
      sourceLocale: 'en',
    });
    expect(plan.units).toEqual([]);
    expect(plan.leftAlone).toHaveLength(1);
  });

  it('refuses past the ceiling rather than starting work it cannot finish', () => {
    const many = Array.from({ length: MAX_CORRECTION_UNITS + 1 }, (_, i) =>
      missing(`app.k${i}`, 'fr'),
    );
    const source: Record<string, string> = {};
    for (const f of many) source[f.key] = 'text';
    const plan = planCorrection({
      report: report(many),
      catalogues: { en: source, fr: {} },
      sourceLocale: 'en',
    });
    expect(plan.units).toEqual([]);
    expect(plan.refusal).toContain(`over the ${MAX_CORRECTION_UNITS}`);
  });
});

describe('applyTranslations', () => {
  it('never overwrites a key that already has a translation', () => {
    const next = applyTranslations(
      { en: { k: 'Source' }, fr: { k: 'Traduction humaine' } },
      [{ locale: 'fr', key: 'k', sourceText: 'Source', text: 'Machine' }],
    );
    expect(next.fr?.k).toBe('Traduction humaine');
  });
});

describe('insertKeys', () => {
  const file = `{\n  "app": {\n    "title": "Acme"\n  }\n}\n`;

  it('adds a nested key and leaves the rest byte for byte', () => {
    const result = insertKeys(file, [
      { path: ['app', 'tagline'], value: 'Tout au même endroit.' },
    ]);
    expect(result.inserted).toEqual(['app.tagline']);
    expect(JSON.parse(result.text)).toEqual({
      app: { title: 'Acme', tagline: 'Tout au même endroit.' },
    });
    // The existing value survives, and so does the trailing newline.
    expect(result.text).toContain('"title": "Acme"');
    expect(result.text.endsWith('\n')).toBe(true);
  });

  it('refuses a key that already exists', () => {
    const result = insertKeys(file, [
      { path: ['app', 'title'], value: 'Overwritten' },
    ]);
    expect(result.inserted).toEqual([]);
    expect(result.skipped[0]?.reason).toBe('already translated');
    expect(result.text).toBe(file);
  });

  /*
   * `a.b` where `a` is already a string. Writing it would replace a real
   * translation with an object — the one way a "safe, additive" write can
   * delete somebody's work.
   */
  it('refuses to turn an existing translation into a group', () => {
    const result = insertKeys(`{\n  "app": "Acme"\n}\n`, [
      { path: ['app', 'title'], value: 'x' },
    ]);
    expect(result.inserted).toEqual([]);
    expect(result.skipped[0]?.reason).toMatch(/already a value/);
  });

  it('leaves an unparseable catalogue untouched', () => {
    const broken = '{ not json';
    const result = insertKeys(broken, [{ path: ['a'], value: 'x' }]);
    expect(result.text).toBe(broken);
    expect(result.skipped[0]?.reason).toMatch(/not valid JSON/);
  });

  it('keeps the indentation the file already used', () => {
    expect(detectIndent(`{\n    "a": 1\n}`)).toBe(4);
    expect(detectIndent(`{\n\t"a": 1\n}`)).toBe('\t');
    expect(detectIndent('{}')).toBe(2);
  });
});

describe('splitKey', () => {
  it('separates the namespace from the path inside the file', () => {
    expect(splitKey('common:app.title')).toEqual({
      namespacePrefix: 'common:',
      path: ['app', 'title'],
    });
    expect(splitKey('app.title')).toEqual({
      namespacePrefix: '',
      path: ['app', 'title'],
    });
  });
});

describe('correctableDirectory', () => {
  // `/v1/open-pr` only accepts paths under `locales/`, so a repository whose
  // catalogues sit elsewhere is analysable and not correctable.
  it('accepts only the directory the pull-request API will write to', () => {
    expect(correctableDirectory('locales')).toBe(true);
    expect(correctableDirectory('public/locales')).toBe(false);
    expect(correctableDirectory('src/locales')).toBe(false);
  });
});

describe('buildCorrection', () => {
  const catalogues = {
    en: { 'auth.greeting': 'Welcome back, {{name}}!' },
    fr: {},
  };
  const base = {
    report: report([missing('auth.greeting', 'fr')]),
    catalogues,
    sourceLocale: 'en',
    usedKeys: ['auth.greeting'],
    dynamicCallSites: 0,
    cataloguesDir: 'locales',
    layout: 'directory-per-locale' as const,
  };
  const frFile = `{\n  "auth": {\n    "signIn": "Se connecter"\n  }\n}\n`;

  it('translates, writes the file and reports what it did', async () => {
    const outcome = await buildCorrection({
      ...base,
      readSource: async () => frFile,
      translate: async () => [
        {
          key: 'auth.greeting',
          text: 'Bon retour, {{name}} !',
          confidence: 'confident',
        },
      ],
    });

    expect(outcome.refusal).toBeNull();
    expect(outcome.files).toHaveLength(1);
    expect(outcome.files[0]?.path).toBe('locales/fr/common.json');
    expect(JSON.parse(outcome.files[0]?.content ?? '{}')).toEqual({
      auth: { signIn: 'Se connecter', greeting: 'Bon retour, {{name}} !' },
    });
    expect(outcome.applied).toHaveLength(1);
  });

  /*
   * The property the re-audit exists for. A translation that drops `{{name}}`
   * is refused *here*, by the same `auditI18n` that would otherwise have
   * reported it one check later — after it had been committed.
   */
  it('refuses a translation that drops a placeholder', async () => {
    const outcome = await buildCorrection({
      ...base,
      readSource: async () => frFile,
      translate: async () => [
        { key: 'auth.greeting', text: 'Bon retour !', confidence: 'confident' },
      ],
    });

    expect(outcome.files).toEqual([]);
    expect(outcome.applied).toEqual([]);
    expect(outcome.rejected).toHaveLength(1);
    expect(outcome.rejected[0]?.reason).toMatch(/\{\{name\}\}/);
    expect(outcome.refusal).toMatch(/refused by the audit/i);
  });

  // Invariant 4: the agent raises ambiguity, it does not guess. A corrective
  // pull request committing a coin flip is the guess with a commit sha on it.
  it('does not commit an ambiguous translation', async () => {
    const outcome = await buildCorrection({
      ...base,
      readSource: async () => frFile,
      translate: async () => [
        { key: 'auth.greeting', text: 'Peut-être', confidence: 'ambiguous' },
      ],
    });
    expect(outcome.files).toEqual([]);
    expect(outcome.refusal).toMatch(/no confident translation/i);
  });

  it('spends nothing when there is nothing it may correct', async () => {
    let called = 0;
    const outcome = await buildCorrection({
      ...base,
      report: report([
        {
          kind: 'placeholder-mismatch',
          key: 'auth.greeting',
          locale: 'fr',
          detail: 'drops {{name}}',
        },
      ]),
      readSource: async () => frFile,
      translate: async () => {
        called += 1;
        return [];
      },
    });
    expect(called).toBe(0);
    expect(outcome.refusal).toMatch(/safe to correct automatically/i);
  });
});

/**
 * What the correction costs, and who is asked before it is spent.
 *
 * The webhook used to reach a paid model with no workspace and no counter —
 * `MAX_CORRECTION_UNITS` bounded one delivery and bounded nothing across a
 * day. These assert the two things that close that: the charge happens, and it
 * happens *first*.
 */
describe('buildCorrection, charged before the model', () => {
  const twoLocales = {
    report: report([missing('app.new', 'fr'), missing('app.new', 'de')]),
    catalogues: {
      en: { 'app.new': 'Save changes' },
      fr: {},
      de: {},
    },
    sourceLocale: 'en',
    usedKeys: ['app.new'],
    dynamicCallSites: 0,
    cataloguesDir: 'locales',
    layout: 'directory-per-locale' as const,
    readSource: async () => `{\n  "app": {}\n}\n`,
  };

  const echo = async (args: {
    targetLocale: string;
    strings: { key: string; text: string }[];
  }) =>
    args.strings.map((s) => ({
      key: s.key,
      text: `[${args.targetLocale}] ${s.text}`,
      confidence: 'confident',
    }));

  it('charges every planned pair once, and before the first translation', async () => {
    const order: string[] = [];
    const charged: number[] = [];

    const outcome = await buildCorrection({
      ...twoLocales,
      charge: async (units) => {
        order.push('charge');
        charged.push(units);
      },
      translate: async (args) => {
        order.push(`translate:${args.targetLocale}`);
        return echo(args);
      },
    });

    /*
     * One key into two locales is two string-language pairs — the unit
     * `consume_api_quota` counts and the unit the API charges a CLI token for.
     * Charging per *key* would under-count by the number of languages, which
     * is the whole shape of this product.
     */
    expect(charged).toEqual([2]);
    // One call for the plan, not one per locale: a correction is one pull
    // request or nothing, so a refusal arriving mid-loop would discard
    // locales already paid for.
    expect(order[0]).toBe('charge');
    expect(order.filter((o) => o === 'charge')).toHaveLength(1);
    expect(order.slice(1).sort()).toEqual(['translate:de', 'translate:fr']);
    expect(outcome.charged).toBe(2);
    expect(outcome.files).toHaveLength(2);
  });

  it('spends nothing on the model when the charge refuses', async () => {
    let translated = 0;

    const outcome = await buildCorrection({
      ...twoLocales,
      charge: async () => {
        throw new Error('This workspace has reached today’s ceiling.');
      },
      translate: async (args) => {
        translated += 1;
        return echo(args);
      },
    });

    expect(translated).toBe(0);
    expect(outcome.files).toEqual([]);
    expect(outcome.applied).toEqual([]);
    expect(outcome.charged).toBe(0);
    expect(outcome.refusal).toBe('This workspace has reached today’s ceiling.');
  });

  /*
   * Fail-closed on a fault, not just on a decision. A charge that throws for
   * any reason stops the correction, because translating on the strength of a
   * check that did not finish is exactly what `chargeWorkspace` refuses to do.
   */
  it('refuses when the charge fails for a reason that is not a quota decision', async () => {
    let translated = 0;
    const outcome = await buildCorrection({
      ...twoLocales,
      charge: async () => {
        throw new Error('fetch failed');
      },
      translate: async (args) => {
        translated += 1;
        return echo(args);
      },
    });
    expect(translated).toBe(0);
    expect(outcome.refusal).toBe('fetch failed');
  });

  /*
   * The plan refuses before the charge does, so a delivery that corrects
   * nothing costs nothing — and that is the common case, since a
   * `placeholder-mismatch` is always left for a person and GitHub redelivers
   * on every push.
   */
  it('does not charge when there is nothing it may correct', async () => {
    let charges = 0;
    const outcome = await buildCorrection({
      ...twoLocales,
      report: report([
        {
          kind: 'placeholder-mismatch',
          key: 'app.new',
          locale: 'fr',
          detail: 'drops {{name}}',
        },
      ]),
      charge: async () => {
        charges += 1;
      },
      translate: echo,
    });
    expect(charges).toBe(0);
    expect(outcome.charged).toBe(0);
    expect(outcome.refusal).toMatch(/safe to correct automatically/i);
  });

  /*
   * What is charged is what was *sent*, not what survived. A translation the
   * re-audit then refuses still reached the model and still cost money; a
   * counter that forgot it would promise budget the API will not honour.
   */
  it('still reports the charge when the audit refuses the result', async () => {
    const outcome = await buildCorrection({
      ...twoLocales,
      report: report([missing('auth.greeting', 'fr')]),
      catalogues: { en: { 'auth.greeting': 'Hello {{name}}' }, fr: {} },
      usedKeys: ['auth.greeting'],
      charge: async () => {},
      translate: async () => [
        { key: 'auth.greeting', text: 'Bonjour', confidence: 'confident' },
      ],
    });

    expect(outcome.files).toEqual([]);
    expect(outcome.refusal).toMatch(/refused by the audit/i);
    expect(outcome.charged).toBe(1);
  });

  // Omitting the hook spends unmetered. Only tests do that, and this pins it
  // so a production caller that forgets is a visible difference, not a default.
  it('reports nothing charged when no charge was supplied', async () => {
    const outcome = await buildCorrection({
      ...twoLocales,
      translate: echo,
    });
    expect(outcome.charged).toBe(0);
    expect(outcome.files).toHaveLength(2);
  });
});

describe('correctionBody', () => {
  it('names what it added and what it left for a person', () => {
    const body = correctionBody({
      sourceLocale: 'en',
      pullNumber: 42,
      outcome: {
        files: [],
        applied: [
          { locale: 'fr', key: 'a.b', sourceText: 'x', text: 'y' },
          { locale: 'de', key: 'a.b', sourceText: 'x', text: 'z' },
        ],
        rejected: [],
        leftAlone: 2,
        charged: 2,
        refusal: null,
      },
    });
    expect(body).toContain('#42');
    expect(body).toContain('**de**');
    expect(body).toContain('**fr**');
    expect(body).toContain('2 other findings');
  });
});
