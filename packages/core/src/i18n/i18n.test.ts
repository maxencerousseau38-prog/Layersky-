import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadI18nextCatalogues } from './catalogue.js';
import { detectI18nLibrary } from './library.js';
import { distinctKeys, scanKeyUsage } from './usage.js';

let root: string;
const dirs: string[] = [];

function project(files: Record<string, string>): string {
  root = mkdtempSync(join(tmpdir(), 'i18n-'));
  dirs.push(root);
  for (const [path, content] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content, 'utf-8');
  }
  return root;
}

afterEach(() => {
  while (dirs.length) {
    rmSync(dirs.pop() as string, { recursive: true, force: true });
  }
});

describe('detectI18nLibrary', () => {
  it('finds i18next through the react binding', () => {
    const dir = project({
      'package.json': JSON.stringify({
        dependencies: { 'react-i18next': '^14' },
      }),
    });
    expect(detectI18nLibrary(dir)).toEqual({
      id: 'i18next',
      packageName: 'react-i18next',
      supported: true,
    });
  });

  it('looks in devDependencies too', () => {
    const dir = project({
      'package.json': JSON.stringify({ devDependencies: { i18next: '^23' } }),
    });
    expect(detectI18nLibrary(dir)?.id).toBe('i18next');
  });

  /*
   * Recognised and told plainly it is not handled, which is a different answer
   * from "no i18n library found" — the difference between "not yet" and "we
   * looked and there is nothing here".
   */
  it('recognises next-intl but marks it unsupported', () => {
    const dir = project({
      'package.json': JSON.stringify({ dependencies: { 'next-intl': '^3' } }),
    });
    expect(detectI18nLibrary(dir)).toMatchObject({
      id: 'next-intl',
      supported: false,
    });
  });

  it('prefers the one it can analyse in a half-migrated project', () => {
    const dir = project({
      'package.json': JSON.stringify({
        dependencies: { 'react-intl': '^6', i18next: '^23' },
      }),
    });
    expect(detectI18nLibrary(dir)?.id).toBe('i18next');
  });

  it('answers null for an unparseable manifest rather than throwing', () => {
    const dir = project({ 'package.json': '{ not json' });
    expect(detectI18nLibrary(dir)).toBeNull();
  });

  it('answers null when there is no manifest at all', () => {
    expect(detectI18nLibrary(project({ 'README.md': 'x' }))).toBeNull();
  });
});

describe('scanKeyUsage', () => {
  it('collects a literal key with its file and line', () => {
    const dir = project({
      'src/Checkout.tsx': [
        'export function Checkout() {',
        "  return <button>{t('checkout.submit')}</button>;",
        '}',
      ].join('\n'),
    });
    const scan = scanKeyUsage(dir, ['src/Checkout.tsx']);
    expect(scan.usages).toEqual([
      { key: 'checkout.submit', filePath: 'src/Checkout.tsx', line: 2 },
    ]);
  });

  it('reads i18n.t and intl.formatMessage as lookups', () => {
    const dir = project({
      'a.ts': "i18n.t('a.one'); intl.formatMessage('a.two');",
    });
    expect(distinctKeys(scanKeyUsage(dir, ['a.ts']))).toEqual([
      'a.one',
      'a.two',
    ]);
  });

  /*
   * The limit that keeps this usable. A computed key cannot be known without
   * running the program, so reporting it as missing would be a false positive
   * on every dynamic catalogue — and a guardrail that cries wolf is switched
   * off within a week. Counted, never claimed.
   */
  it('counts a computed key instead of reporting it', () => {
    const dir = project({
      'a.ts': 'const k = "x"; t(k); t(`item.${k}`);',
    });
    const scan = scanKeyUsage(dir, ['a.ts']);
    expect(scan.usages).toEqual([]);
    expect(scan.dynamicCallSites).toBe(2);
  });

  it('reads a template literal that has no substitutions', () => {
    const dir = project({ 'a.ts': 't(`checkout.submit`);' });
    expect(distinctKeys(scanKeyUsage(dir, ['a.ts']))).toEqual([
      'checkout.submit',
    ]);
  });

  it('ignores an unrelated call that merely ends in a similar name', () => {
    const dir = project({ 'a.ts': "format('nope'); formatDate('nope');" });
    expect(scanKeyUsage(dir, ['a.ts']).usages).toEqual([]);
  });

  /*
   * The file list comes from a pull request, which can name a path a later
   * commit deleted. Failing the whole analysis over one absent file would turn
   * a routine race into a red check.
   */
  it('skips a path that does not exist rather than throwing', () => {
    const dir = project({ 'a.ts': "t('a');" });
    const scan = scanKeyUsage(dir, ['a.ts', 'deleted.ts']);
    expect(distinctKeys(scan)).toEqual(['a']);
  });

  it('deduplicates keys while keeping every call site', () => {
    const dir = project({ 'a.ts': "t('same');\nt('same');" });
    const scan = scanKeyUsage(dir, ['a.ts']);
    expect(scan.usages).toHaveLength(2);
    expect(distinctKeys(scan)).toEqual(['same']);
  });
});

describe('loadI18nextCatalogues', () => {
  it('reads a directory per locale and flattens nesting with a dot', () => {
    const dir = project({
      'public/locales/en/translation.json': JSON.stringify({
        checkout: { submit: 'Go' },
      }),
      'public/locales/fr/translation.json': JSON.stringify({
        checkout: { submit: 'Aller' },
      }),
    });
    const loaded = loadI18nextCatalogues(dir);
    expect(loaded.layout).toBe('directory-per-locale');
    expect(loaded.dir).toBe('public/locales');
    expect(loaded.catalogues.en).toEqual({ 'checkout.submit': 'Go' });
    expect(loaded.catalogues.fr).toEqual({ 'checkout.submit': 'Aller' });
  });

  it('prefixes a named namespace the way i18next addresses it', () => {
    const dir = project({
      'locales/en/translation.json': JSON.stringify({ a: 'A' }),
      'locales/en/common.json': JSON.stringify({ b: 'B' }),
    });
    expect(loadI18nextCatalogues(dir).catalogues.en).toEqual({
      a: 'A',
      'common:b': 'B',
    });
  });

  it('reads a file per locale', () => {
    const dir = project({
      'locales/en.json': JSON.stringify({ a: 'A' }),
      'locales/de.json': JSON.stringify({ a: 'A!' }),
    });
    const loaded = loadI18nextCatalogues(dir);
    expect(loaded.layout).toBe('file-per-locale');
    expect(Object.keys(loaded.catalogues).sort()).toEqual(['de', 'en']);
  });

  /*
   * A non-string entry is skipped, not coerced. Turning `42` into `"42"` would
   * invent a translation the file does not contain and then report it present.
   */
  it('skips a non-string value instead of coercing it', () => {
    const dir = project({
      'locales/en.json': JSON.stringify({ a: 'A', n: 42, arr: ['x'] }),
    });
    expect(loadI18nextCatalogues(dir).catalogues.en).toEqual({ a: 'A' });
  });

  /*
   * Silence and success must not look the same. A project whose catalogues are
   * somewhere this does not look reports `layout: null`, and the caller says so
   * rather than passing a check it never performed.
   */
  it('reports null layout when nothing was found', () => {
    const dir = project({ 'package.json': '{}' });
    expect(loadI18nextCatalogues(dir)).toEqual({
      catalogues: {},
      unreadable: [],
      layout: null,
      // Null, not the last directory tried: a caller comparing a pull request
      // against its base must be unable to classify any path as a catalogue
      // when none were found.
      dir: null,
    });
  });

  it('names a file it could not parse instead of treating it as empty', () => {
    const dir = project({
      'locales/en.json': JSON.stringify({ a: 'A' }),
      'locales/fr.json': '{ broken',
    });
    const loaded = loadI18nextCatalogues(dir);
    expect(loaded.catalogues.fr).toBeUndefined();
    expect(loaded.unreadable).toContain('locales/fr.json');
  });
});
