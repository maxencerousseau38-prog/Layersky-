import { describe, expect, it, vi } from 'vitest';
import { addedSourceKeys } from './analyse';
import { readBaseSourceCatalogue } from './base-catalogue';

describe('addedSourceKeys', () => {
  const head = { 'app.title': 'Acme', 'app.continuousTest': 'Continuous' };

  it('names only what the pull request added', () => {
    expect(addedSourceKeys(head, { 'app.title': 'Acme' })).toEqual([
      'app.continuousTest',
    ]);
  });

  /*
   * The property that keeps this usable. A pull request must answer for the
   * keys it adds, not for every key its repository never translated —
   * reporting the backlog is how a check becomes something people switch off.
   */
  it('never blames the backlog', () => {
    const base = { 'app.title': 'Acme', old1: 'x', old2: 'y' };
    const withOld = { ...base, fresh: 'z' };
    expect(addedSourceKeys(withOld, base)).toEqual(['fresh']);
  });

  it('says nothing when no catalogue was touched', () => {
    expect(addedSourceKeys(head, null)).toEqual([]);
    expect(addedSourceKeys(head, undefined)).toEqual([]);
  });

  /*
   * An added catalogue file has an empty base, not a null one. Every key in it
   * is new, and collapsing the two would hide exactly the pull request that
   * introduces a language file with nothing translated behind it.
   */
  it('treats an added catalogue as all-new', () => {
    expect(addedSourceKeys(head, {}).sort()).toEqual([
      'app.continuousTest',
      'app.title',
    ]);
  });

  it('ignores a changed value, which is not an added key', () => {
    expect(addedSourceKeys({ a: 'new wording' }, { a: 'old wording' })).toEqual(
      [],
    );
  });
});

describe('readBaseSourceCatalogue', () => {
  const args = {
    changedFiles: ['locales/en/common.json'],
    cataloguesDir: 'locales',
    layout: 'directory-per-locale' as const,
    sourceLocale: 'en',
    baseSha: 'base123',
  };

  it('fetches only the source-locale catalogues the PR touched', async () => {
    const fetchFile = vi.fn(async () =>
      JSON.stringify({ app: { title: 'Acme' } }),
    );
    const result = await readBaseSourceCatalogue({ ...args, fetchFile });

    expect(fetchFile).toHaveBeenCalledOnce();
    expect(fetchFile).toHaveBeenCalledWith('locales/en/common.json', 'base123');
    expect(result.catalogue).toEqual({ 'common:app.title': 'Acme' });
    expect(result.touched).toEqual(['locales/en/common.json']);
  });

  /*
   * Seven languages, one changed English file, one request. Fetching every
   * locale would cost six pointless calls against an installation token that
   * is rate-limited per hour.
   */
  it('ignores catalogues of other locales', async () => {
    const fetchFile = vi.fn(async () => '{}');
    const result = await readBaseSourceCatalogue({
      ...args,
      changedFiles: [
        'locales/en/common.json',
        'locales/fr/common.json',
        'locales/ja/common.json',
      ],
      fetchFile,
    });
    expect(fetchFile).toHaveBeenCalledOnce();
    expect(result.touched).toEqual(['locales/en/common.json']);
  });

  it('ignores source files and anything outside the catalogue directory', async () => {
    const fetchFile = vi.fn(async () => '{}');
    const result = await readBaseSourceCatalogue({
      ...args,
      changedFiles: ['src/App.tsx', 'package.json', 'docs/en/common.json'],
      fetchFile,
    });
    expect(fetchFile).not.toHaveBeenCalled();
    expect(result.catalogue).toBeNull();
  });

  /*
   * Null and empty are different answers. Null means "no catalogue changed, so
   * there are no added keys to speak of"; empty means "a catalogue was added,
   * so all of it is new".
   */
  it('answers null — not empty — when no catalogue changed', async () => {
    const result = await readBaseSourceCatalogue({
      ...args,
      changedFiles: ['src/App.tsx'],
      fetchFile: vi.fn(async () => '{}'),
    });
    expect(result.catalogue).toBeNull();
  });

  /*
   * A file added by the pull request has no base version. GitHub answers 404
   * and throws; that is the correct answer, not an error, and the result must
   * still be an object so every key in the head file counts as added.
   */
  it('survives a file that does not exist on the base', async () => {
    const result = await readBaseSourceCatalogue({
      ...args,
      fetchFile: vi.fn(async () => {
        throw new Error('404 Not Found');
      }),
    });
    expect(result.catalogue).toEqual({});
  });

  /*
   * A failed fetch is not an empty file. Treating it as empty would make every
   * key look new and fire a finding per locale for keys that have been there
   * for months.
   */
  it('skips a base file that does not parse rather than calling it empty', async () => {
    const result = await readBaseSourceCatalogue({
      ...args,
      changedFiles: ['locales/en/common.json', 'locales/en/extra.json'],
      fetchFile: vi.fn(async (path: string) =>
        path.endsWith('extra.json') ? '{ broken' : JSON.stringify({ a: 'A' }),
      ),
    });
    expect(result.catalogue).toEqual({ 'common:a': 'A' });
  });

  it('reads the file-per-locale layout too', async () => {
    const result = await readBaseSourceCatalogue({
      ...args,
      changedFiles: ['locales/en.json'],
      layout: 'file-per-locale',
      fetchFile: vi.fn(async () => JSON.stringify({ a: 'A' })),
    });
    // No namespace prefix in this layout.
    expect(result.catalogue).toEqual({ a: 'A' });
  });
});
