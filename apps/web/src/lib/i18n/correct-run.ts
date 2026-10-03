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
 * plan → **charge** → translate → **re-audit** → write. The re-audit is not a
 * formality: the corrected catalogues go back through the same `auditI18n` that
 * produced the findings, and a translation is written only if that function now
 * says nothing about it. A model that drops `{{name}}` is caught here, before a
 * commit, by the same code that would otherwise have caught it one check later.
 *
 * The charge sits between the plan and the first model call, which is the only
 * placement that protects anything: the plan is what makes the cost knowable,
 * and after the call the money is gone and a refusal protects nothing.
 *
 * ## Nothing may vanish, and that is enforced rather than remembered
 *
 * Every unit the plan asked for ends up in `applied` or in `rejected`:
 * `requested === applied.length + rejected.length`, always. The first
 * production cycle is why. Six languages were charged, five were written, and
 * German left no trace — not in the pull request body, not in the webhook's
 * reply, not in a log. The cause was two bare `continue`s and a dropped
 * response field, and the symptom was a pull request that looked complete.
 *
 * The reconciliation at the end is deliberately a backstop, not the mechanism.
 * Each path explains its own refusals; the backstop catches the one nobody
 * thought of and labels it a defect in this tool, so the next hole reports
 * itself instead of waiting for someone to notice a missing language.
 */

export interface CorrectionFile {
  path: string;
  content: string;
}

/** One unit that was asked for and not written, with the reason in prose. */
export interface RejectedUnit {
  unit: CorrectionUnit;
  reason: string;
}

export interface CorrectionOutcome {
  files: CorrectionFile[];
  /** Units written, for the pull request body. */
  applied: (CorrectionUnit & { text: string })[];
  /** Every unit that was asked for and not written, and why. */
  rejected: RejectedUnit[];
  /**
   * Units the plan asked for. Invariant: equal to
   * `applied.length + rejected.length` — a correction cannot lose one.
   */
  requested: number;
  /** Findings deliberately not touched — a person still has to look. */
  leftAlone: number;
  /**
   * String-language pairs charged to the workspace before any model was
   * called. Zero when nothing was charged, which is also zero spent.
   */
  charged: number;
  /**
   * What the model calls consumed, summed over every locale — the ones that
   * answered and the ones that failed. Zero requests means no model was
   * reached, which is what a refusal costs.
   */
  usage: ModelUsage;
  /** Set when nothing was written at all; null when some of it was. */
  refusal: string | null;
}

/**
 * What a set of model calls consumed.
 *
 * Carried out of the correction rather than recorded inside it, for the same
 * reason `charge` is a parameter: this file knows nothing about databases. The
 * webhook writes it, because the webhook is where the organization is known.
 *
 * `requests` counts calls that reached a provider, retries and failures
 * included — they were paid for. The token figures can be zero while
 * `requests` is not, which is what a provider reporting no usage looks like;
 * the two disagreeing is the signal, not an error to smooth over.
 */
export interface ModelUsage {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
}

export const NO_MODEL_USAGE: ModelUsage = {
  requests: 0,
  inputTokens: 0,
  outputTokens: 0,
  thinkingTokens: 0,
};

/** Sum two tallies. Absent usage adds nothing, which is not the same as zero. */
export function addModelUsage(
  total: ModelUsage,
  next: ModelUsage | null | undefined,
): ModelUsage {
  if (!next) return total;
  return {
    requests: total.requests + next.requests,
    inputTokens: total.inputTokens + next.inputTokens,
    outputTokens: total.outputTokens + next.outputTokens,
    thinkingTokens: total.thinkingTokens + next.thinkingTokens,
  };
}

/**
 * The usage a thrown translation error carried.
 *
 * A locale whose every chunk failed is the most expensive outcome there is —
 * up to three paid attempts per chunk and nothing delivered. `/v1/translate`
 * answers 502 with the tally, `translateBatch` puts it on the error, and this
 * reads it back. Without it the worst case would be the only one recorded as
 * free.
 */
export function usageOfError(error: unknown): ModelUsage | null {
  const carried = (error as { usage?: ModelUsage } | null)?.usage;
  return carried && typeof carried.requests === 'number' ? carried : null;
}

/** What `/v1/translate` answers, in full. */
export interface TranslateResult {
  translations: {
    key: string;
    text: string;
    confidence: string;
    question?: string | null;
  }[];
  /** Keys the route answered without. */
  missingKeys: string[];
  /** Chunks the route gave up on, with the error verbatim. */
  failures: { keys: string[]; attempts: number; error: string }[];
  /** What the call consumed. Null from a route or a stub that reports none. */
  usage?: ModelUsage | null;
}

export type TranslateFn = (args: {
  targetLocale: string;
  strings: { key: string; text: string }[];
}) => Promise<TranslateResult>;

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

/**
 * The reason of last resort, and it accuses this code rather than the model.
 *
 * If a reviewer ever reads it, a path exists that drops a unit without saying
 * why — exactly the defect the first production cycle had. Naming it as a bug
 * is what makes the next one visible on its first occurrence.
 */
export const UNEXPLAINED =
  'this correction did not record why the translation was not written — that is a defect in the tool, not a judgement about the translation';

/**
 * The sentence for a unit the translation step did not produce.
 *
 * Pure and exported, so the wording is testable without a network and so the
 * one place that decides cannot drift from the one place that explains.
 *
 * The order of the branches is the order of specificity. A chunk failure says
 * what broke; a non-confident answer is the model doing its job under
 * invariant 4, and its question is the useful part; `missingKeys` is the route
 * stating an omission. The last branch is this tool admitting it does not know,
 * which is a defect report and is worded as one.
 */
export function describeTranslationRefusal(args: {
  result?: { text: string; confidence: string; question?: string | null };
  /** The route listed this key in `missingKeys`. */
  omitted: boolean;
  /** The route reported a chunk failure covering this key. */
  failure?: { attempts: number; error: string };
}): string {
  if (args.failure) {
    const tries = `${args.failure.attempts} attempt${args.failure.attempts === 1 ? '' : 's'}`;
    return `the translation API gave up after ${tries}: ${args.failure.error}`;
  }
  if (args.result && args.result.confidence !== 'confident') {
    return args.result.question
      ? `the model was not confident and asked: ${args.result.question}`
      : 'the model was not confident and gave no question, so this needs a person rather than a guess';
  }
  if (args.result && !args.result.text) {
    return 'the model returned an empty translation';
  }
  if (args.omitted) {
    return 'the translation API answered without this key';
  }
  return UNEXPLAINED;
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
  /**
   * Charge the workspace for the planned pairs, or throw to refuse the whole
   * correction. Called once, with the plan's exact unit count, before the
   * first model call.
   *
   * A function rather than an organization id, so this file keeps knowing
   * nothing about quotas, routes or the database — the same reason `translate`
   * and `readSource` are parameters. Omitting it spends unmetered, which is
   * what tests want and no production caller does.
   */
  charge?: (plannedUnits: number) => Promise<void>;
  maxUnits?: number;
}): Promise<CorrectionOutcome> {
  const plan = planCorrection({
    report: args.report,
    catalogues: args.catalogues,
    sourceLocale: args.sourceLocale,
    maxUnits: args.maxUnits,
  });

  /*
   * The backstop. Every planned unit is either applied or explained, and a unit
   * explained twice is left as two entries so the arithmetic breaks loudly in a
   * test rather than being tidied away in here.
   */
  const reconcile = (
    applied: readonly (CorrectionUnit & { text: string })[],
    rejected: readonly RejectedUnit[],
  ): RejectedUnit[] => {
    const appliedKeys = new Set(applied.map((u) => tupleKey(u.locale, u.key)));
    const explained = new Set<string>();
    const out: RejectedUnit[] = [];
    for (const entry of rejected) {
      const key = tupleKey(entry.unit.locale, entry.unit.key);
      if (explained.has(key)) continue;
      explained.add(key);
      out.push(entry);
    }
    for (const unit of plan.units) {
      const key = tupleKey(unit.locale, unit.key);
      if (appliedKeys.has(key) || explained.has(key)) continue;
      out.push({ unit, reason: UNEXPLAINED });
    }
    return out;
  };

  /*
   * Read by `outcome` from this scope rather than passed in, so no return path
   * can forget it. There are five of them, three of which are refusals, and a
   * refusal reporting spend it did not make — or a failure reporting none —
   * are both wrong in the direction that matters for a price.
   */
  let spent: ModelUsage = NO_MODEL_USAGE;

  const outcome = (partial: {
    files: CorrectionFile[];
    applied: (CorrectionUnit & { text: string })[];
    rejected: readonly RejectedUnit[];
    charged: number;
    refusal: string | null;
  }): CorrectionOutcome => ({
    files: partial.files,
    applied: partial.applied,
    rejected: reconcile(partial.applied, partial.rejected),
    requested: plan.units.length,
    leftAlone: plan.leftAlone.length,
    charged: partial.charged,
    usage: spent,
    refusal: partial.refusal,
  });

  if (plan.refusal) {
    return outcome({
      files: [],
      applied: [],
      rejected: [],
      charged: 0,
      refusal: plan.refusal,
    });
  }

  /*
   * Charged once, for every pair the plan contains, before the first model
   * call — and never per locale.
   *
   * `run-actions.ts` charges per locale because its loop writes each locale as
   * it lands and a resumed run keeps what it bought. This has no resume: a
   * correction is one pull request or nothing, so a refusal arriving on the
   * fourth of six locales would discard three locales already paid for. That
   * is the failure `lib/quota/preflight.ts` exists for, and one atomic
   * `consume_api_quota` call for the whole plan removes it rather than
   * predicting it.
   *
   * What is charged is what is *sent*, not what survives the re-audit. A
   * translation the audit then refuses still reached the model and still cost
   * money, and the counters have to say so — the same rule `/v1/translate`
   * applies to a CLI token. The first production cycle charged 6 and wrote 5,
   * which is this paragraph observed rather than asserted.
   */
  let charged = 0;
  if (args.charge) {
    try {
      await args.charge(plan.units.length);
      charged = plan.units.length;
    } catch (error) {
      /*
       * Any throw refuses the whole correction, including one that is a bug
       * rather than a quota decision. Fail-closed on purpose: the alternative
       * is translating on the strength of a check that did not finish, which
       * is precisely what `chargeWorkspace` refuses to do.
       */
      const reason = error instanceof Error ? error.message : String(error);
      return outcome({
        files: [],
        applied: [],
        rejected: plan.units.map((unit) => ({ unit, reason })),
        charged: 0,
        refusal: reason,
      });
    }
  }

  /*
   * One request per locale, not one per string. `/v1/translate` takes a batch
   * and charges by string either way, so the per-locale shape is the cheaper
   * one in latency and the same one `run-actions.ts` uses — two callers of the
   * same endpoint behaving differently is how one of them ends up untested.
   */
  const candidates: (CorrectionUnit & { text: string })[] = [];
  const rejected: RejectedUnit[] = [];

  for (const locale of plan.locales) {
    const units = plan.units.filter((u) => u.locale === locale);

    let answer: TranslateResult;
    try {
      answer = await args.translate({
        targetLocale: locale,
        strings: units.map((u) => ({ key: u.key, text: u.sourceText })),
      });
      spent = addModelUsage(spent, answer.usage);
    } catch (error) {
      // Before the reason, because a locale that failed still spent. The
      // route answers 502 with the tally and `translateBatch` carries it here.
      spent = addModelUsage(spent, usageOfError(error));
      /*
       * One locale's request failing is one locale's problem. It used to end
       * the whole correction, so a fault on the third of six took the other
       * three with it — and the workspace had already paid for all six. A
       * partial correction is worth more than none, and the locales that did
       * not land now say so by name.
       */
      const message = error instanceof Error ? error.message : String(error);
      for (const unit of units) {
        rejected.push({
          unit,
          reason: `the translation request for \`${locale}\` failed: ${message}`,
        });
      }
      continue;
    }

    const byKey = new Map(answer.translations.map((r) => [r.key, r]));
    const omitted = new Set(answer.missingKeys);
    const failures = new Map<string, { attempts: number; error: string }>();
    for (const failure of answer.failures) {
      for (const key of failure.keys) {
        failures.set(key, {
          attempts: failure.attempts,
          error: failure.error,
        });
      }
    }

    for (const unit of units) {
      const result = byKey.get(unit.key);
      /*
       * An ambiguous translation is not written. Invariant 4: the agent raises
       * ambiguity rather than guessing, and a corrective pull request that
       * quietly commits a coin flip is the guess with a commit sha on it. It
       * stays a finding and the check stays amber — and now the pull request
       * also says which language, and what the model asked.
       */
      if (result && result.confidence === 'confident' && result.text) {
        candidates.push({ ...unit, text: result.text });
        continue;
      }
      rejected.push({
        unit,
        reason: describeTranslationRefusal({
          result,
          omitted: omitted.has(unit.key),
          failure: failures.get(unit.key),
        }),
      });
    }
  }

  if (candidates.length === 0) {
    return outcome({
      files: [],
      applied: [],
      rejected,
      charged,
      refusal: 'No confident translation came back.',
    });
  }

  // The same question, asked of the corrected catalogues.
  const after = auditI18n({
    usedKeys: [...args.usedKeys],
    sourceLocale: args.sourceLocale,
    catalogues: applyTranslations(args.catalogues, candidates),
    dynamicCallSites: args.dynamicCallSites,
  });

  const audit = acceptedTranslations({
    before: args.report,
    after,
    candidates,
  });
  rejected.push(...audit.rejected);

  if (audit.accepted.length === 0) {
    return outcome({
      files: [],
      applied: [],
      rejected,
      charged,
      refusal: 'Every translation was refused by the audit.',
    });
  }

  /*
   * Grouped by file so each catalogue is read once and written once. A key
   * carries its namespace, so two namespaces in one locale are two files.
   */
  const byFile = new Map<
    string,
    { unit: CorrectionUnit & { text: string }; path: string[] }[]
  >();
  for (const unit of audit.accepted) {
    const { namespacePrefix, path } = splitKey(unit.key);
    const file = cataloguePath({
      dir: args.cataloguesDir,
      layout: args.layout,
      locale: unit.locale,
      namespacePrefix,
    });
    byFile.set(file, [...(byFile.get(file) ?? []), { unit, path }]);
  }

  const files: CorrectionFile[] = [];
  const written = new Set<string>();

  for (const [path, entries] of byFile) {
    const original = await args.readSource(path);
    if (original === null) {
      /*
       * Used to be a bare `continue`: an accepted, paid-for translation
       * disappeared because its file could not be read, and nothing said so.
       */
      for (const entry of entries) {
        rejected.push({
          unit: entry.unit,
          reason: `\`${path}\` could not be read from the checkout`,
        });
      }
      continue;
    }

    const result = insertKeys(
      original,
      entries.map((entry) => ({ path: entry.path, value: entry.unit.text })),
    );

    /*
     * `insertKeys` refuses rather than overwrites — a key somebody already
     * translated, or a path that would turn a translation into a group. Each
     * refusal is now a sentence in the pull request instead of a silently
     * shorter diff.
     */
    const unitByDotted = new Map(
      entries.map((entry) => [entry.path.join('.'), entry.unit]),
    );
    for (const skip of result.skipped) {
      const unit = unitByDotted.get(skip.path);
      if (!unit) continue;
      rejected.push({
        unit,
        reason: `\`${path}\` was left alone: ${skip.reason}`,
      });
    }

    if (result.inserted.length === 0) continue;
    files.push({ path, content: result.text });
    for (const dotted of result.inserted) written.add(tupleKey(path, dotted));
  }

  const applied = audit.accepted.filter((unit) => {
    const { namespacePrefix, path } = splitKey(unit.key);
    const file = cataloguePath({
      dir: args.cataloguesDir,
      layout: args.layout,
      locale: unit.locale,
      namespacePrefix,
    });
    return written.has(tupleKey(file, path.join('.')));
  });

  return outcome({
    files,
    applied,
    rejected,
    charged,
    refusal: files.length === 0 ? 'Nothing could be written.' : null,
  });
}

/** Reads a catalogue out of a materialised checkout. */
export function checkoutReader(rootDir: string) {
  return async (path: string): Promise<string | null> =>
    readFile(join(rootDir, path), 'utf-8').catch(() => null);
}

/**
 * The body of the corrective pull request: what it did, and what it did not.
 *
 * The counts come first and they reconcile — asked for, added, left — because a
 * reviewer's first question about a partial correction is whether anything went
 * missing, and the first version of this body could not answer it. Five
 * languages were listed, six had been requested, and nothing on the page said
 * that difference existed.
 */
export function correctionBody(args: {
  outcome: CorrectionOutcome;
  sourceLocale: string;
  pullNumber: number;
}): string {
  const { outcome } = args;

  const addedByLocale = new Map<string, string[]>();
  for (const unit of outcome.applied) {
    addedByLocale.set(unit.locale, [
      ...(addedByLocale.get(unit.locale) ?? []),
      unit.key,
    ]);
  }

  const lines = [
    `Adds the translations missing from #${args.pullNumber}.`,
    '',
    `Each one was translated from \`${args.sourceLocale}\` and then re-checked`,
    'by the same audit that reported it missing — placeholders and ICU included.',
    'Keys that already had a translation were not touched.',
    '',
    `**${outcome.requested} asked for · ${outcome.applied.length} added · ${outcome.rejected.length} left for a person.**`,
    '',
  ];

  if (addedByLocale.size > 0) {
    lines.push('### Added', '');
    for (const [locale, keys] of [...addedByLocale].sort()) {
      lines.push(`- **${locale}** — ${keys.map((k) => `\`${k}\``).join(', ')}`);
    }
    lines.push('');
  }

  /*
   * Named one by one rather than counted. "1 was refused" tells a reviewer
   * something is missing without telling them which language to go and look
   * at, which is the same silence the count was meant to break.
   */
  if (outcome.rejected.length > 0) {
    lines.push(
      '### Not translated, and left for a person',
      '',
      ...outcome.rejected.map(
        (entry) =>
          `- **${entry.unit.locale}** — \`${entry.unit.key}\`: ${entry.reason}`,
      ),
      '',
      `The check on #${args.pullNumber} still reports these, so merging this`,
      'pull request does not resolve them.',
      '',
    );
  }

  if (outcome.leftAlone > 0) {
    lines.push(
      `${outcome.leftAlone} other finding${outcome.leftAlone === 1 ? '' : 's'} on #${args.pullNumber} ${outcome.leftAlone === 1 ? 'is' : 'are'} not corrected automatically — a changed placeholder or a key the source does not define needs a decision, not a translation.`,
    );
  }

  return lines.join('\n').trimEnd();
}
