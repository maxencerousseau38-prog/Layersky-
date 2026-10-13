import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { dependsOn } from './library.js';

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
 * The default namespace's keys are exposed unprefixed, matching
 * `t('checkout.submit')`. Any other file is a named namespace and its keys are
 * prefixed `namespace:key`, matching `t('widgets:checkout.submit')` — which is
 * how i18next itself addresses them.
 *
 * Which file is the default is decided once, by `resolveDefaultNamespace`, and
 * returned as `defaultNamespace` so every reader and writer uses the same
 * answer. It was a constant, `translation`, and two halves disagreed with it:
 * next-i18next's default is `common`, and the correction writer sent
 * unprefixed keys to `common.json` whatever the loader had read.
 */

export type Catalogue = Record<string, string>;

/** i18next's own default namespace, and the answer when nothing says otherwise. */
const DEFAULT_NAMESPACE = 'translation';

/**
 * The namespace an unprefixed `t('key')` resolves to, from what is on disk.
 *
 * Decided from files rather than read from configuration: `defaultNS` lives in
 * code this does not execute, and parsing it out of a config file would be a
 * guess written as a fact. The rules, in order:
 *
 * 1. A `translation.json` exists → `translation`, i18next's own default.
 * 2. The project depends on next-i18next and has a `common.json` → `common`,
 *    next-i18next's documented default (gethomepage/homepage is this shape).
 * 3. Exactly one namespace exists → that one; an unprefixed call can mean no
 *    other file (the i18next fixture is this shape).
 * 4. Otherwise → `translation`. No file is the default, and every key keeps
 *    its prefix — the behaviour before this rule existed.
 */
export function resolveDefaultNamespace(args: {
  namespaces: readonly string[];
  nextI18next: boolean;
}): string {
  const present = new Set(args.namespaces);
  if (present.has(DEFAULT_NAMESPACE)) return DEFAULT_NAMESPACE;
  if (args.nextI18next && present.has('common')) return 'common';
  if (present.size === 1) return [...present][0] as string;
  return DEFAULT_NAMESPACE;
}

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
export function namespacePrefixFor(
  fileName: string,
  defaultNamespace: string = DEFAULT_NAMESPACE,
): string {
  const namespace = fileName.replace(/\.json$/i, '');
  return namespace === defaultNamespace ? '' : `${namespace}:`;
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
  /**
   * Locale to flattened catalogue. Only locales whose every file parsed — a
   * locale with one broken file is absent here and named in `unreadable`.
   */
  catalogues: Record<string, Catalogue>;
  /** Files found but not parseable, repository-relative, in either layout. */
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
  /**
   * The namespace whose keys are unprefixed — see `resolveDefaultNamespace`.
   *
   * Every consumer passes this on: the base reader keys the base the same way,
   * the analysis strips an explicit `<default>:` prefix from code-called keys,
   * and the correction writes an unprefixed key into this file. Meaningless,
   * and `translation`, in the file-per-locale layout, which has no namespaces.
   */
  defaultNamespace: string;
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
 * Takes the directory, layout and default namespace the load already
 * established rather than re-deriving them, so a repository whose catalogues
 * sit in `locales` cannot be read one way by the loader and another way here.
 */
export function classifyCataloguePath(
  dir: string,
  layout: CatalogueLayout,
  path: string,
  defaultNamespace: string = DEFAULT_NAMESPACE,
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
      namespacePrefix: namespacePrefixFor(rest[1] as string, defaultNamespace),
    };
  }

  // locales/<locale>.json — no namespaces in this layout.
  if (rest.length !== 1) return null;
  return {
    locale: (rest[0] as string).replace(/\.json$/i, ''),
    namespacePrefix: '',
  };
}

interface LoadedLayout {
  catalogues: Record<string, Catalogue>;
  /** Files that did not parse, relative to the catalogue directory. */
  unreadable: string[];
}

/*
 * A locale with a file that does not parse is left out entirely, never kept
 * empty or partial. Registered as `{}`, it read as a language that had lost
 * every key: compared with its base, each key looked removed, and the audit
 * reported all of them plus every other language's backlog for them.
 * LAMP-dashboard #863 left a trailing comma in `hi/translation.json` and that
 * produced 2,710 findings, none of which named the file. Left out and named,
 * the locale is reported as unreadable and nothing about it is invented.
 */
/** Every namespace file name present, across all locale directories. */
function namespacesIn(localesDir: string): string[] {
  const names = new Set<string>();
  for (const entry of readdirSync(localesDir)) {
    const localePath = join(localesDir, entry);
    try {
      if (!statSync(localePath).isDirectory()) continue;
      for (const file of readdirSync(localePath)) {
        if (file.endsWith('.json')) names.add(file.slice(0, -'.json'.length));
      }
    } catch {
      // An unreadable directory contributes no namespace; it cannot be loaded
      // either, so it cannot disagree with what is decided here.
    }
  }
  return [...names];
}

function loadDirectoryPerLocale(
  localesDir: string,
  defaultNamespace: string,
): LoadedLayout {
  const catalogues: Record<string, Catalogue> = {};
  const unreadable: string[] = [];
  for (const entry of readdirSync(localesDir)) {
    const localePath = join(localesDir, entry);
    if (!statSync(localePath).isDirectory()) continue;

    const catalogue: Catalogue = {};
    let broken = false;
    for (const file of readdirSync(localePath)) {
      if (!file.endsWith('.json')) continue;
      const namespace = file.slice(0, -'.json'.length);
      const parsed = readJson(join(localePath, file));
      if (parsed === undefined) {
        unreadable.push(`${entry}/${file}`);
        broken = true;
        continue;
      }
      flatten(
        parsed,
        namespace === defaultNamespace ? '' : `${namespace}:`,
        '',
        catalogue,
      );
    }
    if (!broken) catalogues[entry] = catalogue;
  }
  return { catalogues, unreadable };
}

function loadFilePerLocale(localesDir: string): LoadedLayout {
  const catalogues: Record<string, Catalogue> = {};
  const unreadable: string[] = [];
  for (const file of readdirSync(localesDir)) {
    if (!file.endsWith('.json')) continue;
    const parsed = readJson(join(localesDir, file));
    if (parsed === undefined) {
      unreadable.push(file);
      continue;
    }
    const catalogue: Catalogue = {};
    flatten(parsed, '', '', catalogue);
    catalogues[file.slice(0, -'.json'.length)] = catalogue;
  }
  return { catalogues, unreadable };
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

    const defaultNamespace = hasSubdirectory
      ? resolveDefaultNamespace({
          namespaces: namespacesIn(localesDir),
          nextI18next: dependsOn(rootDir, 'next-i18next'),
        })
      : DEFAULT_NAMESPACE;

    const loaded = hasSubdirectory
      ? loadDirectoryPerLocale(localesDir, defaultNamespace)
      : loadFilePerLocale(localesDir);

    // A directory whose only catalogues are broken is still the directory:
    // moving on to the next candidate would report "no catalogues found" about
    // files that are right there.
    if (
      Object.keys(loaded.catalogues).length === 0 &&
      loaded.unreadable.length === 0
    ) {
      continue;
    }

    return {
      catalogues: loaded.catalogues,
      // Reported as found-but-broken rather than merged into the pass: a file
      // that did not parse is the single most likely cause of a surprising
      // result, so the report names it.
      unreadable: loaded.unreadable.map((path) => `${relativeDir}/${path}`),
      layout: hasSubdirectory ? 'directory-per-locale' : 'file-per-locale',
      dir: relativeDir,
      defaultNamespace,
    };
  }

  return {
    catalogues: {},
    unreadable: [],
    layout: null,
    dir: null,
    defaultNamespace: DEFAULT_NAMESPACE,
  };
}
