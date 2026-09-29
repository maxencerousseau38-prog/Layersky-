import 'server-only';
import {
  type CatalogueLayout,
  classifyCataloguePath,
  flattenCatalogueJson,
} from '@localize-infra/core';

/**
 * The source-locale catalogue as it stands on the pull request's base.
 *
 * Only the files the pull request actually touched are fetched, and only the
 * ones belonging to the source locale. A repository with seven languages and
 * one changed English file costs one request, not seven — and never the whole
 * tree, which is what materialising the base commit would have meant.
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
  sourceLocale: string;
  baseSha: string;
}

export interface BaseCatalogueResult {
  /**
   * The merged base catalogue, or null when the pull request touched no
   * source-locale catalogue at all.
   *
   * Null and empty are different answers and must stay so: null means "this
   * pull request changes no catalogue, so there are no added keys to speak
   * of", while an empty object means "it added a catalogue that did not exist,
   * so everything in it is new". Collapsing them would either invent findings
   * or hide them.
   */
  catalogue: Record<string, string> | null;
  /** Catalogue files the pull request touched for the source locale. */
  touched: string[];
}

export async function readBaseSourceCatalogue(
  args: BaseCatalogueArgs,
): Promise<BaseCatalogueResult> {
  const touched: string[] = [];
  for (const path of args.changedFiles) {
    const info = classifyCataloguePath(args.cataloguesDir, args.layout, path);
    if (info && info.locale === args.sourceLocale) touched.push(path);
  }

  if (touched.length === 0) return { catalogue: null, touched: [] };

  const catalogue: Record<string, string> = {};
  for (const path of touched) {
    const info = classifyCataloguePath(args.cataloguesDir, args.layout, path);
    if (!info) continue;

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

    const flat = flattenCatalogueJson(text, info.namespacePrefix);
    if (!flat) continue;
    Object.assign(catalogue, flat);
  }

  return { catalogue, touched };
}
