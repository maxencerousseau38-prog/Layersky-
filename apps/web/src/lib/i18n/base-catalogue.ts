import 'server-only';
import {
  type CatalogueLayout,
  classifyCataloguePath,
  flattenCatalogueJson,
} from '@localize-infra/core';

/**
 * The catalogues, per locale, as they stand on the pull request's base.
 *
 * Only the files the pull request actually touched are fetched — never the
 * whole tree, which is what materialising the base commit would have meant. A
 * repository with seven languages and one changed file costs one request.
 *
 * **Every touched locale, not only the source one.** It was source-only, and
 * pull request #14 showed the hole: dropping `{{name}}` from an existing
 * French translation produced no finding, because the key entered no scope.
 * Degrading a translation that exists is at least as common as forgetting to
 * write one, so the locale filter is gone and the cost is unchanged — still
 * one request per file the pull request actually touched.
 *
 * A file that is *added* by the pull request has no base version; GitHub
 * answers 404 and that is the correct answer, not an error. Its keys are new
 * by definition, so the absent base contributes nothing and every key in the
 * head file counts as added.
 */

export interface BaseCatalogueArgs {
  /** Anything that can fetch a file's text at a ref. Injectable for tests. */
  fetchFile(path: string, ref: string): Promise<string | null>;
  changedFiles: readonly string[];
  cataloguesDir: string;
  layout: CatalogueLayout;
  baseSha: string;
}

export interface BaseCatalogueResult {
  /**
   * Locale to its base catalogue, or null when no catalogue was touched.
   *
   * Null and empty stay different answers. Null means "this pull request
   * changes no catalogue, so there are no changed keys to speak of"; an empty
   * catalogue for a locale means "it added that file, so everything in it is
   * new". Collapsing them would either invent findings or hide them.
   */
  catalogues: Record<string, Record<string, string>> | null;
  /** Catalogue files the pull request touched, any locale. */
  touched: string[];
}

export async function readBaseCatalogues(
  args: BaseCatalogueArgs,
): Promise<BaseCatalogueResult> {
  const touched: { path: string; locale: string; namespacePrefix: string }[] =
    [];
  for (const path of args.changedFiles) {
    const info = classifyCataloguePath(args.cataloguesDir, args.layout, path);
    if (info) touched.push({ path, ...info });
  }

  if (touched.length === 0) return { catalogues: null, touched: [] };

  const catalogues: Record<string, Record<string, string>> = {};
  for (const { path, locale, namespacePrefix } of touched) {
    // A locale whose file could not be read still gets an entry, so the caller
    // can tell "touched but unreadable" from "not touched at all".
    catalogues[locale] ??= {};

    let text: string | null = null;
    try {
      text = await args.fetchFile(path, args.baseSha);
    } catch {
      /*
       * A fetch that failed is not an empty file. Treating it as empty would
       * make every key in the head file look new and fire a finding per locale
       * for keys that have been there for months — the backlog-blaming failure
       * this comparison exists to avoid. Skipping the file means the pull
       * request is judged on the other files it touched, and on nothing
       * invented.
       */
      continue;
    }
    if (text === null) continue;

    const flat = flattenCatalogueJson(text, namespacePrefix);
    if (!flat) continue;
    Object.assign(catalogues[locale] as Record<string, string>, flat);
  }

  return { catalogues, touched: touched.map((t) => t.path) };
}
