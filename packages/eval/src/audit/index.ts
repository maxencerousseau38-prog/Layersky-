import { isIcuMessage, validateIcu } from '../deterministic/icu.js';
import { extractPlaceholders } from '../deterministic/placeholders.js';

/**
 * The i18n audit: what a pull request breaks, before it merges.
 *
 * ## Why here
 *
 * The deterministic checks this leans on — `extractPlaceholders`, `isIcuMessage`,
 * `validateIcu` — already live in this package and are already gated in CI at
 * 99.5%. Putting the audit beside them reuses the checks rather than a second
 * opinion about what a placeholder is. `packages/core` owns the other half, the
 * ts-morph scan for which keys the code calls, because that is where ts-morph
 * already is. Neither package depends on the other: `core` is published to npm
 * and this one is not, so an edge between them would break `npm install` for
 * everybody installing the CLI.
 *
 * ## Pure, and that is the point
 *
 * No filesystem, no network, no GitHub. Everything it needs arrives as
 * arguments, so the whole judgement is testable without a repository and
 * without a webhook — and so the sentence a check prints can be asserted
 * directly rather than scraped out of a rendered page.
 *
 * ## What it deliberately does not report
 *
 * **Unused catalogue keys are counted, never failed on.** A key with no call
 * site in the changed files is the normal state of every key the pull request
 * did not touch, and the analysis only ever sees part of the code. Reporting
 * those as dead would be wrong on the first run and would train the reader to
 * ignore the check.
 */

/** One locale's catalogue: key to translated text. Flattened. */
export type Catalogue = Readonly<Record<string, string>>;

export interface AuditInput {
  /** Distinct keys the changed source asks for. */
  usedKeys: readonly string[];
  /** The source-of-truth locale, e.g. `en`. */
  sourceLocale: string;
  /** Every locale's catalogue, including the source locale. */
  catalogues: Readonly<Record<string, Catalogue>>;
  /**
   * Calls whose key could not be read statically.
   *
   * Carried into the report rather than dropped, so the summary can state what
   * it could not look at instead of implying it looked at everything.
   */
  dynamicCallSites?: number;
}

export type FindingKind =
  /** The code calls a key the source catalogue does not define. */
  | 'missing-source'
  /** The source defines it; a target locale does not. */
  | 'missing-translation'
  /** The translation drops or invents a placeholder the source has. */
  | 'placeholder-mismatch'
  /** The source is ICU and the translation does not parse as ICU. */
  | 'icu-invalid';

export interface Finding {
  kind: FindingKind;
  key: string;
  /** Absent for `missing-source`, which is not about any one locale. */
  locale?: string;
  /** One sentence, in the terms of the person reading a failed check. */
  detail: string;
}

export interface AuditReport {
  findings: Finding[];
  /** Keys examined — the denominator for everything above. */
  keysChecked: number;
  localesChecked: string[];
  dynamicCallSites: number;
  /**
   * Keys defined in the source catalogue with no call site among the changed
   * files. Reported as a number only. See the note above on why.
   */
  unreferencedSourceKeys: number;
}

/**
 * A placeholder difference, described rather than merely detected.
 *
 * `placeholdersIntact` returns a boolean, which is the right shape for a score
 * and the wrong one for a check: "this translation is wrong" without saying
 * which token is missing sends the reader back to diff two strings by eye. So
 * this reuses `extractPlaceholders` — the same tokeniser the boolean uses — and
 * reports the actual difference.
 */
function placeholderDifference(
  source: string,
  translated: string,
): { missing: string[]; added: string[] } | null {
  const count = (text: string) => {
    const counts = new Map<string, number>();
    for (const token of extractPlaceholders(text)) {
      counts.set(token.token, (counts.get(token.token) ?? 0) + 1);
    }
    return counts;
  };

  const sourceCounts = count(source);
  const translatedCounts = count(translated);

  const missing: string[] = [];
  const added: string[] = [];

  for (const [token, n] of sourceCounts) {
    if ((translatedCounts.get(token) ?? 0) < n) missing.push(token);
  }
  for (const [token, n] of translatedCounts) {
    if ((sourceCounts.get(token) ?? 0) < n) added.push(token);
  }

  if (missing.length === 0 && added.length === 0) return null;
  return { missing, added };
}

export function auditI18n(input: AuditInput): AuditReport {
  const findings: Finding[] = [];
  const source = input.catalogues[input.sourceLocale] ?? {};
  const targetLocales = Object.keys(input.catalogues)
    .filter((locale) => locale !== input.sourceLocale)
    .sort();

  for (const key of input.usedKeys) {
    const sourceText = source[key];

    /*
     * A key the source catalogue does not define is reported once, against no
     * locale, and the loop moves on. Reporting it again for every target would
     * turn one mistake into one finding per language — the same shape of noise
     * the run pipeline avoids by re-raising a quota refusal instead of
     * isolating it per locale.
     */
    if (sourceText === undefined) {
      findings.push({
        kind: 'missing-source',
        key,
        detail: `The code calls \`${key}\` but \`${input.sourceLocale}\` does not define it, so every language is missing it.`,
      });
      continue;
    }

    for (const locale of targetLocales) {
      const translated = input.catalogues[locale]?.[key];

      if (translated === undefined) {
        findings.push({
          kind: 'missing-translation',
          key,
          locale,
          detail: `\`${key}\` has no \`${locale}\` translation.`,
        });
        continue;
      }

      const difference = placeholderDifference(sourceText, translated);
      if (difference) {
        const parts: string[] = [];
        if (difference.missing.length > 0) {
          parts.push(`drops ${difference.missing.join(', ')}`);
        }
        if (difference.added.length > 0) {
          parts.push(`adds ${difference.added.join(', ')}`);
        }
        findings.push({
          kind: 'placeholder-mismatch',
          key,
          locale,
          detail: `\`${key}\` in \`${locale}\` ${parts.join(' and ')} compared with \`${input.sourceLocale}\`. At runtime that renders the literal token or throws.`,
        });
      }

      /*
       * ICU is checked only when the *source* is ICU. A plain string translated
       * into a language that needed a plural form is a judgement call, not a
       * deterministic error, and this check does not make judgement calls. The
       * corpus in this package contains no ICU messages at all, which is why
       * /quality prints "No data" for it rather than a percentage — the same
       * honesty applies here: absence of ICU is not a pass.
       */
      if (isIcuMessage(sourceText) && !validateIcu(translated)) {
        findings.push({
          kind: 'icu-invalid',
          key,
          locale,
          detail: `\`${key}\` is an ICU message in \`${input.sourceLocale}\` but the \`${locale}\` translation does not parse as ICU.`,
        });
      }
    }
  }

  const used = new Set(input.usedKeys);
  const unreferencedSourceKeys = Object.keys(source).filter(
    (key) => !used.has(key),
  ).length;

  return {
    findings,
    keysChecked: input.usedKeys.length,
    localesChecked: targetLocales,
    dynamicCallSites: input.dynamicCallSites ?? 0,
    unreferencedSourceKeys,
  };
}

/** Whether a report should fail a check, as one place rather than scattered. */
export function auditPasses(report: AuditReport): boolean {
  return report.findings.length === 0;
}
