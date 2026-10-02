import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadI18nextCatalogues } from '@localize-infra/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { analysePullRequest } from './analyse';
import { buildCorrection, checkoutReader } from './correct-run';

/**
 * The whole cycle, over the real fixture's catalogues.
 *
 * `correct.test.ts` tests the decisions in isolation. This one puts a
 * repository on disk in the shape `localize-infra-fixture-i18next` actually
 * has — `locales/<locale>/common.json`, seven locales, i18next in
 * `package.json` — adds a key to English, and walks: analyse → findings →
 * correct → re-analyse → no findings.
 *
 * The last step is the one worth having. Asserting that a correction was
 * produced says it did something; asserting that the *same analysis* now
 * reports nothing says it did the right thing, and it is the same assertion
 * the GitHub check will make when the corrective pull request merges.
 *
 * No network and no model: the translation function is supplied. What is real
 * is the catalogue shapes, the loader, the audit and the file writing.
 */

const LOCALES = ['en', 'fr', 'de', 'es', 'ja', 'pt-BR', 'ar'] as const;

/** The fixture's `en/common.json`, trimmed to what these assertions use. */
const EN = {
  app: {
    title: 'Acme Dashboard',
    tagline: 'Everything your team ships, in one place.',
  },
  auth: { signIn: 'Sign in', greeting: 'Welcome back, {{name}}!' },
};

const TRANSLATED: Record<string, Record<string, string>> = {
  fr: { app: 'Tableau de bord Acme', auth: 'Se connecter' },
  de: { app: 'Acme Dashboard', auth: 'Anmelden' },
  es: { app: 'Panel de Acme', auth: 'Iniciar sesión' },
  ja: { app: 'Acme ダッシュボード', auth: 'ログイン' },
  'pt-BR': { app: 'Painel da Acme', auth: 'Entrar' },
  ar: { app: 'لوحة تحكم Acme', auth: 'تسجيل الدخول' },
};

let root: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'layersky-cycle-'));
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ name: 'fixture', dependencies: { i18next: '^25.0.0' } }),
  );
  for (const locale of LOCALES) {
    mkdirSync(join(root, 'locales', locale), { recursive: true });
    const catalogue =
      locale === 'en'
        ? EN
        : {
            app: { title: TRANSLATED[locale]?.app ?? 'x', tagline: 'x' },
            auth: {
              signIn: TRANSLATED[locale]?.auth ?? 'x',
              greeting: 'x {{name}}',
            },
          };
    writeFileSync(
      join(root, 'locales', locale, 'common.json'),
      `${JSON.stringify(catalogue, null, 2)}\n`,
    );
  }
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

/**
 * The catalogues as they stood before the pull request.
 *
 * Read through `loadI18nextCatalogues`, the same loader the analysis uses,
 * rather than flattened by hand here. The first version of this helper did
 * flatten by hand and produced `app.title` where the loader produces
 * `common:app.title` — so every pre-existing key looked both deleted and
 * newly added, and the analysis correctly reported four `missing-source`
 * findings about keys that were fine.
 *
 * The bug was in the test, and `apps/web/src/lib/i18n/base-catalogue.ts` was
 * checked before this was changed: it passes `namespacePrefix` into
 * `flattenCatalogueJson`, so the real base reader has always agreed with the
 * loader. Using the loader here is what keeps the test from drifting from it
 * again.
 */
function baseCatalogues(): Record<string, Record<string, string>> {
  return loadI18nextCatalogues(root).catalogues;
}

describe('the correction cycle, on the fixture shape', () => {
  it('reports a new English key as missing everywhere, then fixes it, then reports nothing', async () => {
    const before = baseCatalogues();

    // ── the pull request: one key added to English, nothing else touched ──
    const en = JSON.parse(
      readFileSync(join(root, 'locales', 'en', 'common.json'), 'utf-8'),
    );
    en.app.saveChanges = 'Save changes';
    writeFileSync(
      join(root, 'locales', 'en', 'common.json'),
      `${JSON.stringify(en, null, 2)}\n`,
    );

    const changedFiles = ['locales/en/common.json'];

    // ── detection ──
    const first = analysePullRequest({
      rootDir: root,
      changedFiles,
      sourceLocale: 'en',
      baseCatalogues: before,
    });

    expect(first.skipped).toBeNull();
    const findings = first.report?.findings ?? [];
    // Six target locales, one key.
    expect(findings).toHaveLength(6);
    expect(new Set(findings.map((f) => f.kind))).toEqual(
      new Set(['missing-translation']),
    );
    expect(new Set(findings.map((f) => f.locale))).toEqual(
      new Set(['fr', 'de', 'es', 'ja', 'pt-BR', 'ar']),
    );

    // ── correction ──
    const outcome = await buildCorrection({
      report: first.report as NonNullable<typeof first.report>,
      catalogues: first.audited?.catalogues ?? {},
      sourceLocale: 'en',
      usedKeys: first.audited?.usedKeys ?? [],
      dynamicCallSites: 0,
      cataloguesDir: 'locales',
      layout: 'directory-per-locale',
      readSource: checkoutReader(root),
      translate: async ({ targetLocale, strings }) =>
        strings.map((s) => ({
          key: s.key,
          text: `[${targetLocale}] ${s.text}`,
          confidence: 'confident',
        })),
    });

    expect(outcome.refusal).toBeNull();
    expect(outcome.applied).toHaveLength(6);
    expect(outcome.files).toHaveLength(6);
    expect(outcome.files.map((f) => f.path).sort()).toEqual([
      'locales/ar/common.json',
      'locales/de/common.json',
      'locales/es/common.json',
      'locales/fr/common.json',
      'locales/ja/common.json',
      'locales/pt-BR/common.json',
    ]);

    /*
     * The property that matters most: a correction adds, it does not rewrite.
     * Every key that existed before is byte-identical afterwards, and only the
     * new one appears.
     */
    for (const file of outcome.files) {
      const locale = file.path.split('/')[1] as string;
      const after = JSON.parse(file.content) as Record<
        string,
        Record<string, string>
      >;
      const originalRaw = JSON.parse(
        readFileSync(join(root, file.path), 'utf-8'),
      ) as Record<string, Record<string, string>>;

      expect(after.app?.title).toBe(originalRaw.app?.title);
      expect(after.auth?.signIn).toBe(originalRaw.auth?.signIn);
      expect(after.auth?.greeting).toBe(originalRaw.auth?.greeting);
      expect(after.app?.saveChanges).toBe(`[${locale}] Save changes`);
      expect(file.content.endsWith('\n')).toBe(true);
    }

    // ── the corrective pull request lands: write the files ──
    for (const file of outcome.files) {
      writeFileSync(join(root, file.path), file.content);
    }

    // ── the check runs again, and this is the green ──
    const second = analysePullRequest({
      rootDir: root,
      changedFiles: [...changedFiles, ...outcome.files.map((f) => f.path)],
      sourceLocale: 'en',
      baseCatalogues: before,
    });

    expect(second.skipped).toBeNull();
    expect(second.report?.findings).toEqual([]);
  });

  it('leaves the rest of the catalogue alone when only one locale is missing a key', async () => {
    const before = baseCatalogues();

    const en = JSON.parse(
      readFileSync(join(root, 'locales', 'en', 'common.json'), 'utf-8'),
    );
    en.auth.signOut = 'Sign out';
    writeFileSync(
      join(root, 'locales', 'en', 'common.json'),
      `${JSON.stringify(en, null, 2)}\n`,
    );
    // Every locale but French already has it, so only French is in scope.
    for (const locale of LOCALES.filter((l) => l !== 'en' && l !== 'fr')) {
      const raw = JSON.parse(
        readFileSync(join(root, 'locales', locale, 'common.json'), 'utf-8'),
      );
      raw.auth.signOut = 'translated';
      writeFileSync(
        join(root, 'locales', locale, 'common.json'),
        `${JSON.stringify(raw, null, 2)}\n`,
      );
    }

    const analysis = analysePullRequest({
      rootDir: root,
      changedFiles: ['locales/en/common.json'],
      sourceLocale: 'en',
      baseCatalogues: before,
    });

    const outcome = await buildCorrection({
      report: analysis.report as NonNullable<typeof analysis.report>,
      catalogues: analysis.audited?.catalogues ?? {},
      sourceLocale: 'en',
      usedKeys: analysis.audited?.usedKeys ?? [],
      dynamicCallSites: 0,
      cataloguesDir: 'locales',
      layout: 'directory-per-locale',
      readSource: checkoutReader(root),
      translate: async ({ strings }) =>
        strings.map((s) => ({
          key: s.key,
          text: 'Se déconnecter',
          confidence: 'confident',
        })),
    });

    expect(outcome.files.map((f) => f.path)).toEqual([
      'locales/fr/common.json',
    ]);
    const fr = JSON.parse(outcome.files[0]?.content ?? '{}');
    expect(fr.auth.signOut).toBe('Se déconnecter');
    // The human translation already in the file is untouched.
    expect(fr.auth.signIn).toBe('Se connecter');
  });
});
