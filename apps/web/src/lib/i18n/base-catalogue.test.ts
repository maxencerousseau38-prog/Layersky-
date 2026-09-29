import { describe, expect, it, vi } from 'vitest';
import { changedCatalogueKeys } from './analyse';
import { readBaseCatalogues } from './base-catalogue';

describe('changedCatalogueKeys', () => {
  const head = { 'app.title': 'Acme', 'app.continuousTest': 'Continuous' };

  it('names a key the pull request added', () => {
    expect(changedCatalogueKeys(head, { 'app.title': 'Acme' })).toEqual([
      'app.continuousTest',
    ]);
  });

  /*
   * The generalisation pull request #14 forced. Its French file dropped
   * `{{name}}` from an existing translation and nothing was reported, because
   * only added keys were in scope. An edited value is exactly where a
   * placeholder goes missing.
   */
  it('names a key whose value was edited', () => {
    expect(
      changedCatalogueKeys(
        { greeting: 'Bon retour !' },
        { greeting: 'Bon retour, {{name}} !' },
      ),
    ).toEqual(['greeting']);
  });

  /** A deleted translation enters scope, and the audit reports it missing. */
  it('names a key the pull request removed', () => {
    expect(changedCatalogueKeys({}, { gone: 'x' })).toEqual(['gone']);
  });

  it('says nothing about a key it left alone', () => {
    expect(changedCatalogueKeys({ a: 'same' }, { a: 'same' })).toEqual([]);
  });

  /*
   * The property that keeps this usable. A pull request answers for what it
   * touched, never for every key its repository never translated — reporting
   * the backlog is how a check becomes something people switch off.
   */
  it('never blames the backlog', () => {
    const base = { 'app.title': 'Acme', old1: 'x', old2: 'y' };
    expect(changedCatalogueKeys({ ...base, fresh: 'z' }, base)).toEqual([
      'fresh',
    ]);
  });

  it('says nothing when no catalogue was touched', () => {
    expect(changedCatalogueKeys(head, null)).toEqual([]);
    expect(changedCatalogueKeys(head, undefined)).toEqual([]);
  });

  /*
   * An added catalogue file has an empty base, not a null one. Everything in
   * it is new, and collapsing the two would hide the pull request that adds a
   * language file with nothing behind it.
   */
  it('treats an added catalogue as all-new', () => {
    expect(changedCatalogueKeys(head, {}).sort()).toEqual([
      'app.continuousTest',
      'app.title',
    ]);
  });
});

describe('readBaseCatalogues', () => {
  const args = {
    changedFiles: ['locales/en/common.json'],
    cataloguesDir: 'locales',
    layout: 'directory-per-locale' as const,
    baseSha: 'base123',
  };

  it('fetches the catalogues the PR touched, keyed by locale', async () => {
    const fetchFile = vi.fn(async () =>
      JSON.stringify({ app: { title: 'Acme' } }),
    );
    const result = await readBaseCatalogues({ ...args, fetchFile });

    expect(fetchFile).toHaveBeenCalledWith('locales/en/common.json', 'base123');
    expect(result.catalogues).toEqual({
      en: { 'common:app.title': 'Acme' },
    });
  });

  /*
   * Target locales are read now, not only the source one. Without them an
   * edited French translation is invisible — the hole pull request #14 found.
   */
  it('reads a target locale the PR touched', async () => {
    const result = await readBaseCatalogues({
      ...args,
      changedFiles: ['locales/fr/common.json'],
      fetchFile: vi.fn(async () => JSON.stringify({ greeting: 'Bonjour' })),
    });
    expect(result.catalogues).toEqual({
      fr: { 'common:greeting': 'Bonjour' },
    });
  });

  /*
   * One request per file the pull request actually touched — never one per
   * language. The installation token is rate-limited per hour.
   */
  it('fetches nothing for a locale the PR left alone', async () => {
    const fetchFile = vi.fn(async () => '{}');
    const result = await readBaseCatalogues({
      ...args,
      changedFiles: ['locales/en/common.json', 'locales/fr/common.json'],
      fetchFile,
    });
    expect(fetchFile).toHaveBeenCalledTimes(2);
    expect(Object.keys(result.catalogues ?? {}).sort()).toEqual(['en', 'fr']);
  });

  it('ignores source files and anything outside the catalogue directory', async () => {
    const fetchFile = vi.fn(async () => '{}');
    const result = await readBaseCatalogues({
      ...args,
      changedFiles: ['src/App.tsx', 'package.json', 'docs/en/common.json'],
      fetchFile,
    });
    expect(fetchFile).not.toHaveBeenCalled();
    expect(result.catalogues).toBeNull();
  });

  it('answers null — not empty — when no catalogue changed', async () => {
    const result = await readBaseCatalogues({
      ...args,
      changedFiles: ['src/App.tsx'],
      fetchFile: vi.fn(async () => '{}'),
    });
    expect(result.catalogues).toBeNull();
  });

  /*
   * A file added by the pull request has no base version. GitHub answers 404
   * and throws; that is the correct answer, not an error, and the locale must
   * still get an entry so every key in the head file counts as changed.
   */
  it('survives a file that does not exist on the base', async () => {
    const result = await readBaseCatalogues({
      ...args,
      fetchFile: vi.fn(async () => {
        throw new Error('404 Not Found');
      }),
    });
    expect(result.catalogues).toEqual({ en: {} });
  });

  /*
   * A failed fetch is not an empty file. Treating it as empty would make every
   * key look changed and fire findings for keys untouched for months.
   */
  it('skips a base file that does not parse rather than calling it empty', async () => {
    const result = await readBaseCatalogues({
      ...args,
      changedFiles: ['locales/en/common.json', 'locales/en/extra.json'],
      fetchFile: vi.fn(async (path: string) =>
        path.endsWith('extra.json') ? '{ broken' : JSON.stringify({ a: 'A' }),
      ),
    });
    expect(result.catalogues).toEqual({ en: { 'common:a': 'A' } });
  });

  it('reads the file-per-locale layout too', async () => {
    const result = await readBaseCatalogues({
      ...args,
      changedFiles: ['locales/en.json'],
      layout: 'file-per-locale',
      fetchFile: vi.fn(async () => JSON.stringify({ a: 'A' })),
    });
    // No namespace prefix in this layout.
    expect(result.catalogues).toEqual({ en: { a: 'A' } });
  });
});
