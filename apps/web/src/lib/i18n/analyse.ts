import 'server-only';
import { rm } from 'node:fs/promises';
import { analysableFiles } from '@/lib/github/webhook';
import {
  detectI18nLibrary,
  distinctKeys,
  loadI18nextCatalogues,
  scanKeyUsage,
} from '@localize-infra/core';
import { type AuditReport, auditI18n } from '@localize-infra/eval';

/**
 * One pull request, analysed.
 *
 * Joins the two halves that were built to have no knowledge of each other:
 * `packages/core` reads source and catalogues, `packages/eval` judges. This is
 * the only place that knows both, and it knows nothing about GitHub beyond the
 * file list it is handed.
 *
 * ## Why a report is returned even when nothing could be analysed
 *
 * A repository with no i18next, or with catalogues somewhere this does not
 * look, must produce a check that *says so*. Returning null and letting the
 * caller skip would leave the reviewer with silence, and silence on a pull
 * request reads as approval. `skipped` carries the reason; the caller prints
 * it.
 */

export interface AnalysisResult {
  report: AuditReport | null;
  /** Why no audit was run. Null when one was. */
  skipped: string | null;
}

export interface AnalyseArgs {
  /** A checkout of the pull request's head. */
  rootDir: string;
  /** Files the pull request touches, repository-relative. */
  changedFiles: readonly string[];
  /**
   * The locale treated as the source of truth.
   *
   * Defaults to `en` because that is what i18next projects overwhelmingly use
   * and because guessing wrong is visible immediately — every key would report
   * as missing from the source. Not read from a config file: i18next's
   * `fallbackLng` lives in code that this does not execute, and inferring it
   * would be a guess dressed as a fact.
   */
  sourceLocale?: string;
  /**
   * The source-locale catalogue as it stands on the pull request's base.
   *
   * Without it the analysis only ever sees keys the *code* asks for, and the
   * most common real change is the opposite one: somebody adds an English
   * string and nobody translates it. Pull request #13 on the i18next fixture
   * was exactly that — one line added to `locales/en/common.json`, no source
   * touched — and the check answered "No translation keys were touched",
   * which was true of what it had looked at and useless about what mattered.
   *
   * Comparing against the base rather than auditing the whole file is what
   * keeps this honest: a pull request must be answerable for the keys it adds,
   * not for every key its repository has never translated. Reporting the
   * backlog is how a check becomes something people switch off.
   *
   * **Every touched locale, not only the source one.** It was the source
   * catalogue alone, and pull request #14 on the fixture showed what that
   * misses: it dropped `{{name}}` from an existing French translation, and the
   * check said nothing. The key was neither called by changed code nor added
   * to English, so it was in no scope at all — while degrading a translation
   * that already exists is at least as common as forgetting to write one.
   *
   * Null when the pull request touches no catalogue, or when the base could
   * not be read. Then the changed keys are unknown and nothing is invented.
   */
  baseCatalogues?: Record<string, Record<string, string>> | null;
}

/**
 * Keys this pull request changed in one catalogue.
 *
 * Changed, not added — the generalisation pull request #14 forced. A value
 * that was edited matters as much as one that appeared: reworded English makes
 * every translation of it suspect, and an edited French string is exactly
 * where a placeholder goes missing. Presence differences count too, so a
 * deleted translation enters scope and is reported as missing.
 *
 * Widening from added to changed cannot manufacture findings. A key whose
 * placeholders still line up produces nothing, so the cost of a large
 * reformatting commit is a longer scope and an unchanged, empty result.
 */
export function changedCatalogueKeys(
  head: Readonly<Record<string, string>>,
  base: Readonly<Record<string, string>> | null | undefined,
): string[] {
  if (!base) return [];
  const keys = new Set([...Object.keys(head), ...Object.keys(base)]);
  return [...keys].filter((key) => head[key] !== base[key]);
}

export function analysePullRequest(args: AnalyseArgs): AnalysisResult {
  const library = detectI18nLibrary(args.rootDir);
  if (!library) {
    return {
      report: null,
      skipped:
        'No i18n library found in package.json, so there is nothing to check.',
    };
  }
  if (!library.supported) {
    return {
      report: null,
      skipped: `This repository uses ${library.packageName}, which Layersky does not analyse yet. Only i18next is supported today.`,
    };
  }

  const catalogues = loadI18nextCatalogues(args.rootDir);
  if (catalogues.layout === null) {
    return {
      report: null,
      skipped:
        'No i18next catalogues were found in public/locales, locales or src/locales, so nothing could be compared.',
    };
  }

  const sourceLocale = args.sourceLocale ?? 'en';
  if (!catalogues.catalogues[sourceLocale]) {
    return {
      report: null,
      skipped: `No \`${sourceLocale}\` catalogue was found, so there is no source of truth to compare against.`,
    };
  }

  const scan = scanKeyUsage(args.rootDir, analysableFiles(args.changedFiles));

  /*
   * Two ways a key enters this pull request's scope, and both are audited.
   *
   * The code calls it, from the changed source files. Or the pull request
   * changes it in **any** catalogue it touches — the source one, where a new
   * English string arrives untranslated, or a target one, where an existing
   * translation is edited and loses a placeholder. Merged and de-duplicated,
   * because a pull request doing both must report a key once.
   *
   * A key changed only in a target locale is still audited against the source
   * catalogue: that is what makes `missing-source` fire when somebody
   * translates a key English does not define.
   */
  const fromCatalogues = new Set<string>();
  for (const [locale, headCatalogue] of Object.entries(catalogues.catalogues)) {
    for (const key of changedCatalogueKeys(
      headCatalogue,
      args.baseCatalogues?.[locale],
    )) {
      fromCatalogues.add(key);
    }
  }

  const usedKeys = [...new Set([...distinctKeys(scan), ...fromCatalogues])];

  return {
    report: auditI18n({
      usedKeys,
      sourceLocale,
      catalogues: catalogues.catalogues,
      dynamicCallSites: scan.dynamicCallSites,
    }),
    skipped: null,
  };
}

/**
 * Remove a checkout, never letting cleanup fail the analysis.
 *
 * The same shape `startRun`'s finally block uses: a temporary directory that
 * could not be deleted is disk to reclaim, and turning that into a failed
 * check would report an i18n problem that does not exist.
 */
export async function discardCheckout(dir: string | null): Promise<void> {
  if (!dir) return;
  await rm(dir, { recursive: true, force: true }).catch(() => {});
}
