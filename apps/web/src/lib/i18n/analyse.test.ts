import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { analysePullRequest } from './analyse';
import { readBaseCatalogues } from './base-catalogue';

/**
 * A catalogue that does not parse, end to end through the analysis.
 *
 * Measured on a real repository before it was fixed: LAMP-dashboard #863
 * (`f50633c`) added eleven lines to `public/locales/hi/translation.json` and
 * left a trailing comma before the closing brace. The analysis loaded Hindi as
 * an empty catalogue, compared it with a base of 1,075 keys, and reported every
 * one of them as removed — then reported every other language's backlog for
 * those keys too. 2,710 findings; the file that no longer parsed was named
 * nowhere.
 */

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

function repository(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'layersky-analyse-'));
  dirs.push(root);
  const all = {
    'package.json': JSON.stringify({ dependencies: { i18next: '^23.0.0' } }),
    ...files,
  };
  for (const [path, content] of Object.entries(all)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

/** Thirty keys, the backlog shape: each target language lacks the last five. */
const KEYS = Array.from({ length: 30 }, (_, i) => `key${i}`);
const catalogue = (prefix: string, count = KEYS.length) =>
  JSON.stringify(
    Object.fromEntries(KEYS.slice(0, count).map((k) => [k, `${prefix} ${k}`])),
    null,
    2,
  );
/** The breakage observed in LAMP-dashboard: valid entries, then `,\n}`. */
const trailingComma = `{\n${KEYS.map((k) => `"${k}": "हिं ${k}"`).join(',\n')},\n}\n`;

const HINDI = 'public/locales/hi/translation.json';

describe('analysePullRequest with a catalogue that does not parse', () => {
  it('reports the broken file instead of a flood of missing translations', () => {
    const root = repository({
      'public/locales/en/translation.json': catalogue('EN'),
      'public/locales/de/translation.json': catalogue('DE', 25),
      'public/locales/fr/translation.json': catalogue('FR', 25),
      [HINDI]: trailingComma,
    });

    const analysis = analysePullRequest({
      rootDir: root,
      changedFiles: [HINDI],
      // What `readBaseCatalogues` returns when the base version was valid.
      baseCatalogues: {
        hi: Object.fromEntries(KEYS.map((k) => [k, `हिं ${k}`])),
      },
    });

    expect(analysis.skipped).toBeNull();
    expect(analysis.report?.unreadableCatalogues).toEqual([HINDI]);
    // Nothing invented: no Hindi key reported as removed, no backlog dragged in.
    expect(analysis.report?.findings).toEqual([]);
    expect(analysis.report?.localesChecked).not.toContain('hi');
    expect(analysis.audited?.unreadable).toEqual([HINDI]);
  });

  it('still audits the readable languages the pull request changed', () => {
    const root = repository({
      'public/locales/en/translation.json': catalogue('EN'),
      'public/locales/de/translation.json': JSON.stringify({
        ...JSON.parse(catalogue('DE')),
        key0: 'DE without its placeholder',
      }),
      [HINDI]: trailingComma,
    });

    const analysis = analysePullRequest({
      rootDir: root,
      changedFiles: ['public/locales/de/translation.json', HINDI],
      baseCatalogues: {
        de: JSON.parse(catalogue('DE')),
        hi: Object.fromEntries(KEYS.map((k) => [k, `हिं ${k}`])),
      },
    });

    // One edited German key is in scope; Hindi is named, not audited.
    expect(analysis.report?.keysChecked).toBe(1);
    expect(analysis.report?.localesChecked).toEqual(['de']);
    expect(analysis.report?.unreadableCatalogues).toEqual([HINDI]);
  });

  /*
   * The source of truth itself. Nothing can be judged against a catalogue that
   * cannot be read, and saying "no `en` catalogue was found" would send the
   * reader looking for a file that is right there.
   */
  it('names the broken source catalogue rather than claiming it is absent', () => {
    const root = repository({
      'public/locales/en/translation.json': '{ "a": "A", }',
      'public/locales/fr/translation.json': JSON.stringify({ a: 'Á' }),
    });

    const analysis = analysePullRequest({
      rootDir: root,
      changedFiles: ['public/locales/en/translation.json'],
    });

    expect(analysis.report).toBeNull();
    expect(analysis.audited).toBeNull();
    expect(analysis.skipped).toContain('public/locales/en/translation.json');
    expect(analysis.skipped).toContain('not valid JSON');
  });

  /*
   * The pull request that repairs the file. Its base does not parse; read as
   * empty, every repaired key would look added and every other language's
   * backlog for those keys would be blamed on the fix.
   */
  it('does not report a repair as thirty new keys', async () => {
    const root = repository({
      'public/locales/en/translation.json': catalogue('EN'),
      'public/locales/de/translation.json': catalogue('DE', 25),
      [HINDI]: catalogue('हिं'),
    });

    const base = await readBaseCatalogues({
      fetchFile: vi.fn(async () => trailingComma),
      changedFiles: [HINDI],
      cataloguesDir: 'public/locales',
      layout: 'directory-per-locale',
      baseSha: 'base',
    });
    const analysis = analysePullRequest({
      rootDir: root,
      changedFiles: [HINDI],
      baseCatalogues: base.catalogues,
    });

    expect(analysis.report?.findings).toEqual([]);
    expect(analysis.report?.keysChecked).toBe(0);
  });
});
