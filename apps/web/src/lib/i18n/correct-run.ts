import 'server-only';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { cataloguePath, insertKeys, splitKey } from '@/lib/i18n/catalogue-file';
import {
  type CorrectionUnit,
  acceptedTranslations,
  applyTranslations,
  planCorrection,
} from '@/lib/i18n/correct';
import type { CatalogueLayout } from '@localize-infra/core';
import { type AuditReport, auditI18n } from '@localize-infra/eval';

/**
 * The correction half of the cycle: findings in, a set of files out.
 *
 * Everything that talks to the outside is a parameter — `translate` and
 * `readSource` — so the whole decision path is testable without a model, a
 * network or a repository. The webhook supplies the real ones.
 *
 * ## The order is the safety property
 *
 * plan → translate → **re-audit** → write. The re-audit is not a formality:
 * the corrected catalogues go back through the same `auditI18n` that produced
 * the findings, and a translation is written only if that function now says
 * nothing about it. A model that drops `{{name}}` is caught here, before a
 * commit, by the same code that would otherwise have caught it one check
 * later.
 */

export interface CorrectionFile {
  path: string;
  content: string;
}

export interface CorrectionOutcome {
  files: CorrectionFile[];
  /** Units written, for the pull request body. */
  applied: (CorrectionUnit & { text: string })[];
  /** Translations the re-audit refused, with the audit's own sentence. */
  rejected: { unit: CorrectionUnit; reason: string }[];
  /** Findings deliberately not touched — a person still has to look. */
  leftAlone: number;
  /** Set when nothing was attempted; null when work was done. */
  refusal: string | null;
}

export type TranslateFn = (args: {
  targetLocale: string;
  strings: { key: string; text: string }[];
}) => Promise<{ key: string; text: string; confidence: string }[]>;

/**
 * A composite map key, built so it cannot collide.
 *
 * `JSON.stringify` of the parts rather than joining them with a separator: a
 * locale cannot contain a quote or a bracket, but a catalogue *key* can
 * contain almost anything, and a separator chosen because it "cannot appear"
 * is the assumption that eventually does.
 */
function tupleKey(a: string, b: string): string {
  return JSON.stringify([a, b]);
}

export async function buildCorrection(args: {
  report: AuditReport;
  catalogues: Readonly<Record<string, Readonly<Record<string, string>>>>;
  sourceLocale: string;
  /** Keys the audit examined, so the re-audit asks the same question. */
  usedKeys: readonly string[];
  dynamicCallSites: number;
  cataloguesDir: string;
  layout: CatalogueLayout;
  /** Reads a catalogue file from the checkout. Repository-relative path. */
  readSource: (path: string) => Promise<string | null>;
  translate: TranslateFn;
  maxUnits?: number;
}): Promise<CorrectionOutcome> {
  const plan = planCorrection({
    report: args.report,
    catalogues: args.catalogues,
    sourceLocale: args.sourceLocale,
    maxUnits: args.maxUnits,
  });

  if (plan.refusal) {
    return {
      files: [],
      applied: [],
      rejected: [],
      leftAlone: plan.leftAlone.length,
      refusal: plan.refusal,
    };
  }

  /*
   * One request per locale, not one per string. `/v1/translate` takes a batch
   * and charges by string either way, so the per-locale shape is the cheaper
   * one in latency and the same one `run-actions.ts` uses — two callers of the
   * same endpoint behaving differently is how one of them ends up untested.
   */
  const candidates: (CorrectionUnit & { text: string })[] = [];
  for (const locale of plan.locales) {
    const units = plan.units.filter((u) => u.locale === locale);
    const results = await args.translate({
      targetLocale: locale,
      strings: units.map((u) => ({ key: u.key, text: u.sourceText })),
    });
    const byKey = new Map(results.map((r) => [r.key, r]));
    for (const unit of units) {
      const result = byKey.get(unit.key);
      /*
       * An ambiguous translation is not written. Invariant 4: the agent
       * raises ambiguity rather than guessing, and a corrective pull request
       * that quietly commits a coin flip is the guess with a commit sha on it.
       * It stays a finding, and the check stays amber.
       */
      if (!result || result.confidence !== 'confident' || !result.text) {
        continue;
      }
      candidates.push({ ...unit, text: result.text });
    }
  }

  if (candidates.length === 0) {
    return {
      files: [],
      applied: [],
      rejected: [],
      leftAlone: plan.leftAlone.length,
      refusal: 'No confident translation came back.',
    };
  }

  // The same question, asked of the corrected catalogues.
  const after = auditI18n({
    usedKeys: [...args.usedKeys],
    sourceLocale: args.sourceLocale,
    catalogues: applyTranslations(args.catalogues, candidates),
    dynamicCallSites: args.dynamicCallSites,
  });

  const { accepted, rejected } = acceptedTranslations({
    before: args.report,
    after,
    candidates,
  });

  if (accepted.length === 0) {
    return {
      files: [],
      applied: [],
      rejected,
      leftAlone: plan.leftAlone.length,
      refusal: 'Every translation was refused by the audit.',
    };
  }

  /*
   * Grouped by file so each catalogue is read once and written once. A key
   * carries its namespace, so two namespaces in one locale are two files.
   */
  const byFile = new Map<string, { path: string[]; value: string }[]>();
  for (const unit of accepted) {
    const { namespacePrefix, path } = splitKey(unit.key);
    const file = cataloguePath({
      dir: args.cataloguesDir,
      layout: args.layout,
      locale: unit.locale,
      namespacePrefix,
    });
    const entries = byFile.get(file) ?? [];
    entries.push({ path, value: unit.text });
    byFile.set(file, entries);
  }

  const files: CorrectionFile[] = [];
  const written = new Set<string>();
  for (const [path, entries] of byFile) {
    const original = await args.readSource(path);
    if (original === null) continue;
    const result = insertKeys(original, entries);
    if (result.inserted.length === 0) continue;
    files.push({ path, content: result.text });
    for (const dotted of result.inserted) written.add(tupleKey(path, dotted));
  }

  const applied = accepted.filter((unit) => {
    const { namespacePrefix, path } = splitKey(unit.key);
    const file = cataloguePath({
      dir: args.cataloguesDir,
      layout: args.layout,
      locale: unit.locale,
      namespacePrefix,
    });
    return written.has(tupleKey(file, path.join('.')));
  });

  return {
    files,
    applied,
    rejected,
    leftAlone: plan.leftAlone.length,
    refusal: files.length === 0 ? 'Nothing could be written.' : null,
  };
}

/** Reads a catalogue out of a materialised checkout. */
export function checkoutReader(rootDir: string) {
  return async (path: string): Promise<string | null> =>
    readFile(join(rootDir, path), 'utf-8').catch(() => null);
}

/** The body of the corrective pull request: what it did, and what it did not. */
export function correctionBody(args: {
  outcome: CorrectionOutcome;
  sourceLocale: string;
  pullNumber: number;
}): string {
  const byLocale = new Map<string, string[]>();
  for (const unit of args.outcome.applied) {
    byLocale.set(unit.locale, [...(byLocale.get(unit.locale) ?? []), unit.key]);
  }

  const lines = [
    `Adds the translations missing from #${args.pullNumber}.`,
    '',
    `Each one was translated from \`${args.sourceLocale}\` and then re-checked`,
    'by the same audit that reported it missing — placeholders and ICU included.',
    'Keys that already had a translation were not touched.',
    '',
  ];

  for (const [locale, keys] of [...byLocale].sort()) {
    lines.push(`- **${locale}** — ${keys.map((k) => `\`${k}\``).join(', ')}`);
  }

  if (args.outcome.rejected.length > 0) {
    lines.push(
      '',
      'Refused by the audit and left for a person:',
      ...args.outcome.rejected.map(
        (r) => `- \`${r.unit.key}\` (${r.unit.locale}) — ${r.reason}`,
      ),
    );
  }

  if (args.outcome.leftAlone > 0) {
    lines.push(
      '',
      `${args.outcome.leftAlone} other finding${args.outcome.leftAlone === 1 ? '' : 's'} on #${args.pullNumber} ${args.outcome.leftAlone === 1 ? 'is' : 'are'} not corrected automatically — a changed placeholder or a key the source does not define needs a decision, not a translation.`,
    );
  }

  return lines.join('\n');
}
