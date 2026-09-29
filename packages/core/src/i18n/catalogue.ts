import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Where i18next keeps its catalogues, and how to flatten them.
 *
 * ## Two layouts, because i18next has two and both are common
 *
 *   locales/en/translation.json     ← directory per language, namespace per file
 *   locales/en.json                 ← file per language, no namespaces
 *
 * Both are looked for, in that order. A project using the first and also
 * carrying a stray `en.json` is read as the first, because a directory is the
 * deliberate choice and a loose file beside it is usually a leftover.
 *
 * ## Nesting is flattened with a dot, which is what the caller already speaks
 *
 * `{"checkout": {"submit": "Go"}}` becomes `checkout.submit`. That is what
 * `t('checkout.submit')` asks for, so flattening here means the audit compares
 * like with like rather than teaching every consumer the tree shape.
 *
 * i18next's own default separator is `.`, and a project that changed it would
 * be read wrongly. That is a real limit of this slice and it is stated here
 * rather than discovered: `keySeparator: false` or a custom separator is not
 * supported, and the analysis would report false missing keys on such a repo.
 *
 * ## Namespaces
 *
 * `translation.json` is i18next's default namespace and its keys are exposed
 * unprefixed, matching `t('checkout.submit')`. Any other file is a named
 * namespace and its keys are prefixed `namespace:key`, matching
 * `t('common:checkout.submit')` — which is how i18next itself addresses them.
 */

export type Catalogue = Record<string, string>;

/** i18next's default namespace: its keys carry no prefix. */
const DEFAULT_NAMESPACE = 'translation';

/**
 * `namespace` is joined with nothing; `path` segments are joined with a dot.
 *
 * They were one string, and the test caught it: a namespace prefix of
 * `common:` came out as `common:.b` because every segment got a separator. A
 * namespace is not a key segment — i18next writes `common:checkout.submit`,
 * one colon and then dots — so the two have to be tracked apart.
 */
function flatten(
  value: unknown,
  namespace: string,
  path: string,
  into: Catalogue,
): void {
  if (typeof value === 'string') {
    into[`${namespace}${path}`] = value;
    return;
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    /*
     * Numbers, booleans, arrays and null are skipped rather than coerced. A
     * catalogue entry that is not a string is not a translation, and turning
     * `42` into `"42"` here would invent a translation the file does not
     * contain — then report it as present.
     */
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    flatten(child, namespace, path ? `${path}.${key}` : key, into);
  }
}

/**
 * Flatten one catalogue file whose text is already in hand.
 *
 * Exported for the case the loader below cannot serve: reading a file as it
 * exists on the pull request's **base** commit, which is not on disk. Fetching
 * that blob and flattening it here means one implementation of "what a key is
 * called", rather than a second one that would drift the first time a
 * separator changed.
 *
 * `namespace` is the prefix i18next would address these keys by — empty for
 * the default namespace, `common:` for a file named `common.json`.
 */
export function flattenCatalogueJson(
  text: string,
  namespace: string,
): Catalogue | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const catalogue: Catalogue = {};
  flatten(parsed, namespace, '', catalogue);
  return catalogue;
}

/** The namespace prefix a catalogue file's keys carry, from its filename. */
export function namespacePrefixFor(fileName: string): string {
  const namespace = fileName.replace(/\.json$/i, '');
  return namespace === DEFAULT_NAMESPACE ? '' : `${namespace}:`;
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    /*
     * Unreadable is not empty, and the difference matters: an empty catalogue
     * would make every key "missing" and fail a check for a reason the author
     * cannot act on from that message. The caller distinguishes them — see
     * `unreadable` on the result.
     */
    return undefined;
  }
}

export type CatalogueLayout = 'directory-per-locale' | 'file-per-locale';

export interface LoadedCatalogues {
  /** Locale to flattened catalogue. Only locales that parsed. */
  catalogues: Record<string, Catalogue>;
  /** Files found but not parseable, repository-relative. */
  unreadable: string[];
  /** Where the catalogues were found, for a report that must be checkable. */
  layout: CatalogueLayout | null;
  /**
   * The directory the catalogues came from, repository-relative.
   *
   * Returned because a caller comparing a pull request against its base has to
   * recognise which changed paths are catalogues, and guessing that from the
   * candidate list again would be a second answer to a question this function
   * already settled.
   */
  dir: string | null;
}

/** What a changed path is, if it is a catalogue at all. */
export interface CatalogueFile {
  locale: string;
  /** The prefix its keys carry: '' for the default namespace, else `ns:`. */
  namespacePrefix: string;
}

/**
 * Decide whether a changed path is a catalogue, and whose.
 *
 * Takes the directory and layout the load already established rather than
 * re-deriving them, so a repository whose catalogues sit in `locales` cannot be
 * read one way by the loader and another way here.
 */
export function classifyCataloguePath(
  dir: string,
  layout: CatalogueLayout,
  path: string,
): CatalogueFile | null {
  const normalised = path.replace(/\\/g, '/');
  if (!normalised.startsWith(`${dir}/`)) return null;
  if (!/\.json$/i.test(normalised)) return null;

  const rest = normalised.slice(dir.length + 1).split('/');

  if (layout === 'directory-per-locale') {
    // locales/<locale>/<namespace>.json — anything deeper is not a catalogue
    // this loader would have read, so it is not one here either.
    if (rest.length !== 2) return null;
    return {
      locale: rest[0] as string,
      namespacePrefix: namespacePrefixFor(rest[1] as string),
    };
  }

  // locales/<locale>.json — no namespaces in this layout.
  if (rest.length !== 1) return null;
  return {
    locale: (rest[0] as string).replace(/\.json$/i, ''),
    namespacePrefix: '',
  };
}

function loadDirectoryPerLocale(localesDir: string): Record<string, Catalogue> {
  const catalogues: Record<string, Catalogue> = {};
  for (const entry of readdirSync(localesDir)) {
    const localePath = join(localesDir, entry);
    if (!statSync(localePath).isDirectory()) continue;

    const catalogue: Catalogue = {};
    for (const file of readdirSync(localePath)) {
      if (!file.endsWith('.json')) continue;
      const namespace = file.slice(0, -'.json'.length);
      const parsed = readJson(join(localePath, file));
      if (parsed === undefined) continue;
      flatten(
        parsed,
        namespace === DEFAULT_NAMESPACE ? '' : `${namespace}:`,
        '',
        catalogue,
      );
    }
    catalogues[entry] = catalogue;
  }
  return catalogues;
}

function loadFilePerLocale(localesDir: string): Record<string, Catalogue> {
  const catalogues: Record<string, Catalogue> = {};
  for (const file of readdirSync(localesDir)) {
    if (!file.endsWith('.json')) continue;
    const parsed = readJson(join(localesDir, file));
    if (parsed === undefined) continue;
    const catalogue: Catalogue = {};
    flatten(parsed, '', '', catalogue);
    catalogues[file.slice(0, -'.json'.length)] = catalogue;
  }
  return catalogues;
}

/**
 * The directories checked, in order, and why these.
 *
 * `public/locales` is where next-i18next puts them and is the most common in a
 * Next.js app; `locales` and `src/locales` cover the rest. A project that keeps
 * them somewhere else is not analysed, and the report says no catalogues were
 * found rather than that everything passed — silence and success must not look
 * the same.
 */
const CANDIDATE_DIRS = ['public/locales', 'locales', 'src/locales'];

export function loadI18nextCatalogues(rootDir: string): LoadedCatalogues {
  for (const relativeDir of CANDIDATE_DIRS) {
    const localesDir = join(rootDir, relativeDir);
    if (!existsSync(localesDir)) continue;

    let entries: string[];
    try {
      entries = readdirSync(localesDir);
    } catch {
      continue;
    }

    const hasSubdirectory = entries.some((entry) => {
      try {
        return statSync(join(localesDir, entry)).isDirectory();
      } catch {
        return false;
      }
    });

    const catalogues = hasSubdirectory
      ? loadDirectoryPerLocale(localesDir)
      : loadFilePerLocale(localesDir);

    if (Object.keys(catalogues).length === 0) continue;

    // Reported as found-but-broken rather than merged into the pass: a file
    // that did not parse is the single most likely cause of a surprising
    // result, so the report names it.
    const unreadable: string[] = [];
    for (const entry of entries) {
      const path = join(localesDir, entry);
      if (entry.endsWith('.json') && readJson(path) === undefined) {
        unreadable.push(`${relativeDir}/${entry}`);
      }
    }

    return {
      catalogues,
      unreadable,
      layout: hasSubdirectory ? 'directory-per-locale' : 'file-per-locale',
      dir: relativeDir,
    };
  }

  return { catalogues: {}, unreadable: [], layout: null, dir: null };
}
