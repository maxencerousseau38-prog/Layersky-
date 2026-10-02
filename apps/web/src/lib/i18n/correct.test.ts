import type { AuditReport, Finding } from '@localize-infra/eval';
import { describe, expect, it } from 'vitest';
import { detectIndent, insertKeys, splitKey } from './catalogue-file';
import {
  MAX_CORRECTION_UNITS,
  applyTranslations,
  correctableDirectory,
  planCorrection,
} from './correct';
import {
  type TranslateResult,
  UNEXPLAINED,
  buildCorrection,
  correctionBody,
  describeTranslationRefusal,
} from './correct-run';

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

/**
 * `/v1/translate`'s full answer, defaulted.
 *
 * `missingKeys` and `failures` are part of the contract and used to be dropped
 * by the caller, which is how a language vanished in production. They are
 * explicit here so a test that wants one has to say so, and a test that wants
 * neither still sees them as empty rather than absent.
 */
const answers = (
  translations: {
    key: string;
    text: string;
    confidence?: string;
    question?: string | null;
  }[],
  extra: Partial<Omit<TranslateResult, 'translations'>> = {},
): TranslateResult => ({
  translations: translations.map((t) => ({
    confidence: 'confident',
    question: null,
    ...t,
  })),
  missingKeys: extra.missingKeys ?? [],
  failures: extra.failures ?? [],
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
      translate: async () =>
        answers([{ key: 'auth.greeting', text: 'Bon retour, {{name}} !' }]),
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
      translate: async () =>
        answers([{ key: 'auth.greeting', text: 'Bon retour !' }]),
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
      translate: async () =>
        answers([
          {
            key: 'auth.greeting',
            text: 'Peut-être',
            confidence: 'ambiguous',
            question: 'Is this a greeting or a farewell?',
          },
        ]),
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
        return answers([]);
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
    answers(
      args.strings.map((s) => ({
        key: s.key,
        text: `[${args.targetLocale}] ${s.text}`,
      })),
    );

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
      translate: async () =>
        answers([{ key: 'auth.greeting', text: 'Bonjour' }]),
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
        requested: 2,
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

/**
 * The defect the first production cycle found, turned into assertions.
 *
 * On 2026-10-02 a real pull request added one English key, the workspace was
 * charged for six languages, five were written, and German disappeared: not in
 * the pull request body, not in the webhook's reply, not in a log. The
 * corrective pull request was titled "add 5 missing translations" and read as
 * complete.
 *
 * Two bare `continue`s and a dropped response field caused it. These tests pin
 * the shape of that exact run — 6 asked for, 5 added, 1 refused — and then the
 * other ways a unit can fall out, because the hole was never about German.
 *
 * The load-bearing assertion in all of them is the same one:
 * `requested === applied.length + rejected.length`. A correction cannot lose a
 * language without breaking that arithmetic.
 */
describe('buildCorrection, six asked for and five written', () => {
  const TARGETS = ['fr', 'de', 'es', 'ja', 'pt-BR', 'ar'] as const;
  const KEY = 'errors.timeout';
  const SOURCE = 'The request took too long. Please try again.';

  const sixLocales = {
    report: report(TARGETS.map((locale) => missing(KEY, locale))),
    catalogues: {
      en: { [KEY]: SOURCE },
      ...Object.fromEntries(TARGETS.map((l) => [l, {}])),
    },
    sourceLocale: 'en',
    usedKeys: [KEY],
    dynamicCallSites: 0,
    cataloguesDir: 'locales',
    layout: 'directory-per-locale' as const,
    readSource: async () => `{\n  "errors": {}\n}\n`,
  };

  /** Confident everywhere except the locales named, which answer `how`. */
  const allBut =
    (
      how: (locale: string) => TranslateResult | Error,
      broken: readonly string[],
    ) =>
    async (args: { targetLocale: string; strings: { key: string }[] }) => {
      if (broken.includes(args.targetLocale)) {
        const answer = how(args.targetLocale);
        if (answer instanceof Error) throw answer;
        return answer;
      }
      return answers([{ key: KEY, text: `[${args.targetLocale}] ${SOURCE}` }]);
    };

  it('writes five, names the sixth, and the counts reconcile', async () => {
    const charged: number[] = [];
    const outcome = await buildCorrection({
      ...sixLocales,
      charge: async (units) => {
        charged.push(units);
      },
      translate: allBut(
        () =>
          answers([
            {
              key: KEY,
              text: 'Die Anfrage hat zu lange gedauert.',
              confidence: 'ambiguous',
              question: 'Is "Anfrage" the right word for an HTTP request here?',
            },
          ]),
        ['de'],
      ),
    });

    // The arithmetic that makes a vanished language impossible.
    expect(outcome.requested).toBe(6);
    expect(outcome.applied).toHaveLength(5);
    expect(outcome.rejected).toHaveLength(1);
    expect(outcome.applied.length + outcome.rejected.length).toBe(
      outcome.requested,
    );

    // A partial correction is still a correction: five files, and no refusal.
    expect(outcome.files).toHaveLength(5);
    expect(outcome.files.map((f) => f.path).sort()).toEqual([
      'locales/ar/common.json',
      'locales/es/common.json',
      'locales/fr/common.json',
      'locales/ja/common.json',
      'locales/pt-BR/common.json',
    ]);
    expect(outcome.refusal).toBeNull();

    // German is named, with the model's own question.
    expect(outcome.rejected[0]?.unit.locale).toBe('de');
    expect(outcome.rejected[0]?.unit.key).toBe(KEY);
    expect(outcome.rejected[0]?.reason).toContain('not confident');
    expect(outcome.rejected[0]?.reason).toContain('"Anfrage"');

    // Charged for what was sent, which is still six. Unchanged by this fix.
    expect(charged).toEqual([6]);
    expect(outcome.charged).toBe(6);

    // Nothing German reached a file.
    expect(outcome.files.some((f) => f.path.includes('/de/'))).toBe(false);
  });

  it('says so in the pull request body, by language and by reason', async () => {
    const outcome = await buildCorrection({
      ...sixLocales,
      translate: allBut(
        () =>
          answers([
            {
              key: KEY,
              text: 'x',
              confidence: 'ambiguous',
              question: 'Which register?',
            },
          ]),
        ['de'],
      ),
    });

    const body = correctionBody({
      outcome,
      sourceLocale: 'en',
      pullNumber: 15,
    });

    // The headline a reviewer sees before opening the diff.
    expect(body).toContain('**6 asked for');
    expect(body).toContain('5 added');
    expect(body).toContain('1 left for a person.**');
    expect(body).toContain('### Added');
    expect(body).toContain('### Not translated, and left for a person');
    expect(body).toContain('- **de** — `errors.timeout`: ');
    expect(body).toContain('Which register?');
    // And it does not claim that merging it finishes the job.
    expect(body).toContain('does not resolve them');

    // Every added locale is listed; German is not among them.
    for (const locale of ['fr', 'es', 'ja', 'pt-BR', 'ar']) {
      expect(body).toContain(`- **${locale}** — \`errors.timeout\``);
    }
    expect(body.split('### Added')[1]?.split('###')[0]).not.toContain('**de**');
  });

  /*
   * Four other ways a unit used to fall out silently. Each one is a different
   * sentence, because each one has a different remedy: wait, retry, decide, or
   * report a bug in this tool.
   */
  it.each([
    [
      'listed in missingKeys',
      () => answers([], { missingKeys: [KEY] }),
      /answered without this key/,
    ],
    [
      'covered by a chunk failure',
      () =>
        answers([], {
          failures: [{ keys: [KEY], attempts: 3, error: 'upstream timeout' }],
        }),
      /gave up after 3 attempts: upstream timeout/,
    ],
    [
      'answered with an empty string',
      () => answers([{ key: KEY, text: '' }]),
      /empty translation/,
    ],
    [
      'absent from the answer for no stated reason',
      () => answers([{ key: 'some.other.key', text: 'x' }]),
      /defect in the tool/,
    ],
  ])('accounts for a unit %s', async (_label, how, expected) => {
    const outcome = await buildCorrection({
      ...sixLocales,
      translate: allBut(how as () => TranslateResult, ['de']),
    });

    expect(outcome.requested).toBe(6);
    expect(outcome.applied).toHaveLength(5);
    expect(outcome.rejected).toHaveLength(1);
    expect(outcome.rejected[0]?.unit.locale).toBe('de');
    expect(outcome.rejected[0]?.reason).toMatch(expected as RegExp);
  });

  /*
   * A request that throws used to end the whole correction — so a fault on the
   * third of six took the other three with it, after all six had been paid
   * for. One locale's fault is now one locale's entry.
   */
  it('isolates a locale whose request throws', async () => {
    const outcome = await buildCorrection({
      ...sixLocales,
      translate: allBut(() => new Error('502 Bad Gateway'), ['de']),
    });

    expect(outcome.applied).toHaveLength(5);
    expect(outcome.files).toHaveLength(5);
    expect(outcome.rejected).toHaveLength(1);
    expect(outcome.rejected[0]?.reason).toContain('502 Bad Gateway');
    expect(outcome.applied.length + outcome.rejected.length).toBe(6);
  });

  /*
   * The write side had the same hole twice: a catalogue that cannot be read,
   * and a key `insertKeys` refuses. Both were bare `continue`s, so an accepted
   * and already paid-for translation disappeared.
   */
  it('reports a catalogue it could not read', async () => {
    const outcome = await buildCorrection({
      ...sixLocales,
      readSource: async (path) =>
        path.includes('/de/') ? null : `{\n  "errors": {}\n}\n`,
      translate: allBut(() => answers([]), []),
    });

    expect(outcome.applied).toHaveLength(5);
    expect(outcome.rejected).toHaveLength(1);
    expect(outcome.rejected[0]?.unit.locale).toBe('de');
    expect(outcome.rejected[0]?.reason).toMatch(/could not be read/);
    expect(outcome.applied.length + outcome.rejected.length).toBe(6);
  });

  it('reports a key insertKeys refused to overwrite', async () => {
    const outcome = await buildCorrection({
      ...sixLocales,
      readSource: async (path) =>
        path.includes('/de/')
          ? `{\n  "errors": {\n    "timeout": "Schon ubersetzt"\n  }\n}\n`
          : `{\n  "errors": {}\n}\n`,
      translate: allBut(() => answers([]), []),
    });

    expect(outcome.applied).toHaveLength(5);
    expect(outcome.rejected).toHaveLength(1);
    expect(outcome.rejected[0]?.reason).toMatch(/already translated/);
    // And the existing translation is still there, untouched.
    expect(outcome.files.some((f) => f.path.includes('/de/'))).toBe(false);
  });

  /*
   * The whole-correction refusals must reconcile too. A quota refusal asks for
   * six and writes none, so all six are accounted for — otherwise the body of
   * that correction would list nothing at all.
   */
  it('accounts for every unit when the charge refuses', async () => {
    const outcome = await buildCorrection({
      ...sixLocales,
      charge: async () => {
        throw new Error('the daily ceiling is reached');
      },
      translate: allBut(() => answers([]), []),
    });

    expect(outcome.requested).toBe(6);
    expect(outcome.applied).toEqual([]);
    expect(outcome.rejected).toHaveLength(6);
    expect(new Set(outcome.rejected.map((r) => r.unit.locale))).toEqual(
      new Set(TARGETS),
    );
    expect(outcome.charged).toBe(0);
  });

  it('accounts for every unit when the audit refuses all of them', async () => {
    const outcome = await buildCorrection({
      ...sixLocales,
      catalogues: {
        en: { 'auth.greeting': 'Welcome back, {{name}}!' },
        ...Object.fromEntries(TARGETS.map((l) => [l, {}])),
      },
      report: report(TARGETS.map((l) => missing('auth.greeting', l))),
      usedKeys: ['auth.greeting'],
      // Every locale drops the placeholder, so every one is refused.
      translate: async () =>
        answers([{ key: 'auth.greeting', text: 'no placeholder here' }]),
    });

    expect(outcome.requested).toBe(6);
    expect(outcome.applied).toEqual([]);
    expect(outcome.rejected).toHaveLength(6);
    expect(outcome.refusal).toMatch(/refused by the audit/i);
  });
});

describe('describeTranslationRefusal', () => {
  it('prefers the chunk failure, then the model, then the omission', () => {
    expect(
      describeTranslationRefusal({
        omitted: true,
        failure: { attempts: 1, error: 'boom' },
        result: { text: '', confidence: 'ambiguous', question: 'q' },
      }),
    ).toMatch(/gave up after 1 attempt: boom/);

    expect(
      describeTranslationRefusal({
        omitted: true,
        result: { text: 'x', confidence: 'ambiguous', question: 'which one?' },
      }),
    ).toBe('the model was not confident and asked: which one?');

    expect(
      describeTranslationRefusal({
        omitted: false,
        result: { text: 'x', confidence: 'ambiguous', question: null },
      }),
    ).toMatch(/gave no question/);

    expect(describeTranslationRefusal({ omitted: true })).toMatch(
      /answered without this key/,
    );
  });

  /*
   * The one sentence that blames this code. It must stay reachable, so that a
   * future hole reports itself instead of waiting to be noticed.
   */
  it('admits when it does not know, and calls that a defect', () => {
    expect(describeTranslationRefusal({ omitted: false })).toBe(UNEXPLAINED);
    expect(UNEXPLAINED).toContain('defect in the tool');
  });
});
