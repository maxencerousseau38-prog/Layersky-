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

  return {
    report: auditI18n({
      usedKeys: distinctKeys(scan),
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
