import type { CatalogueLayout } from '@localize-infra/core';

/**
 * Writing a key back into a real catalogue file.
 *
 * ## Why this edits text instead of regenerating it
 *
 * The analysis works on *flattened* catalogues — `common:app.title` to a
 * string — because that is the shape a comparison needs. Writing that shape
 * back out would produce a file with every key re-ordered, every nesting
 * level rebuilt and every byte of formatting the repository had chosen
 * replaced. The diff would be the whole file, for a one-line change.
 *
 * Worse than ugly: it would make "preserve the existing translations"
 * unverifiable by eye. A reviewer can see that a two-line diff adds two keys.
 * Nobody can see it in a 200-line reformat.
 *
 * So the correction parses the file the repository actually has, sets the one
 * path, and serialises with the indentation that file was using.
 */

/** Where a locale's catalogue lives, for the two layouts the loader knows. */
export function cataloguePath(args: {
  /** Repository-relative directory the loader reported. */
  dir: string;
  layout: CatalogueLayout;
  locale: string;
  /** '' for the default namespace, else `ns:`. */
  namespacePrefix: string;
}): string {
  const namespace = args.namespacePrefix
    ? args.namespacePrefix.slice(0, -1)
    : 'common';
  return args.layout === 'directory-per-locale'
    ? `${args.dir}/${args.locale}/${namespace}.json`
    : `${args.dir}/${args.locale}.json`;
}

/**
 * Split a flattened key into the namespace it belongs to and the path inside
 * that file.
 *
 * `common:app.title` → `{ namespacePrefix: 'common:', path: ['app','title'] }`
 * `app.title`        → `{ namespacePrefix: '',        path: ['app','title'] }`
 */
export function splitKey(key: string): {
  namespacePrefix: string;
  path: string[];
} {
  const colon = key.indexOf(':');
  if (colon === -1) return { namespacePrefix: '', path: key.split('.') };
  return {
    namespacePrefix: key.slice(0, colon + 1),
    path: key.slice(colon + 1).split('.'),
  };
}

/**
 * The indentation a JSON file already uses, so the edit does not reformat it.
 *
 * Falls back to two spaces, which is what every catalogue in the fixture and
 * every one this has seen uses. Tabs are detected rather than assumed away.
 */
export function detectIndent(text: string): string | number {
  const match = text.match(/\n([ \t]+)"/);
  if (!match?.[1]) return 2;
  return match[1].startsWith('\t') ? '\t' : match[1].length;
}

export interface InsertResult {
  text: string;
  /** Keys actually written. A key already present is never one of them. */
  inserted: string[];
  /** Keys skipped, with why. */
  skipped: { path: string; reason: string }[];
}

/**
 * Insert values into a catalogue's JSON text, touching nothing else.
 *
 * Refuses rather than overwrites in two cases, and both are the same
 * principle: this may add what is absent, never replace what is there.
 *
 *  - the leaf already exists — somebody translated it;
 *  - the path runs through an existing string — `a.b` where `a` is already a
 *    translation, so writing it would delete that translation to make room
 *    for an object.
 */
export function insertKeys(
  text: string,
  entries: readonly { path: string[]; value: string }[],
): InsertResult {
  const indent = detectIndent(text);
  const endsWithNewline = text.endsWith('\n');

  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch {
    return {
      text,
      inserted: [],
      skipped: entries.map((e) => ({
        path: e.path.join('.'),
        reason: 'the catalogue is not valid JSON',
      })),
    };
  }
  if (root === null || typeof root !== 'object' || Array.isArray(root)) {
    return {
      text,
      inserted: [],
      skipped: entries.map((e) => ({
        path: e.path.join('.'),
        reason: 'the catalogue is not a JSON object',
      })),
    };
  }

  const inserted: string[] = [];
  const skipped: { path: string; reason: string }[] = [];

  for (const entry of entries) {
    const dotted = entry.path.join('.');
    let node = root as Record<string, unknown>;
    let blocked: string | null = null;

    for (const segment of entry.path.slice(0, -1)) {
      const child = node[segment];
      if (child === undefined) {
        const created: Record<string, unknown> = {};
        node[segment] = created;
        node = created;
        continue;
      }
      if (child === null || typeof child !== 'object' || Array.isArray(child)) {
        blocked = `\`${segment}\` is already a value, not a group`;
        break;
      }
      node = child as Record<string, unknown>;
    }
    if (blocked) {
      skipped.push({ path: dotted, reason: blocked });
      continue;
    }

    const leaf = entry.path[entry.path.length - 1];
    if (leaf === undefined) {
      skipped.push({ path: dotted, reason: 'empty key' });
      continue;
    }
    if (node[leaf] !== undefined) {
      skipped.push({ path: dotted, reason: 'already translated' });
      continue;
    }

    node[leaf] = entry.value;
    inserted.push(dotted);
  }

  if (inserted.length === 0) return { text, inserted, skipped };

  const serialised = JSON.stringify(root, null, indent);
  return {
    text: endsWithNewline ? `${serialised}\n` : serialised,
    inserted,
    skipped,
  };
}
