import type { AuditReport, Finding } from '@localize-infra/eval';

/**
 * What a corrective pull request would contain, decided before anything is
 * spent.
 *
 * ## One case, and the refusals that keep it to one
 *
 * The only thing this corrects is `missing-translation`: the source catalogue
 * defines a key and a target locale does not. Every other finding is left
 * alone and left visible.
 *
 * That is not caution for its own sake. A `placeholder-mismatch` means an
 * existing translation disagrees with its source, and which of the two is
 * wrong is a judgement — overwriting the translation would silently discard
 * somebody's work to make a check go green, which is the opposite of what the
 * check is for. `missing-source` means the code calls a key English does not
 * define; inventing the English is inventing product copy. `icu-invalid` is a
 * broken existing translation, same argument as the placeholder case.
 *
 * So the planner answers with units it is sure about and says what it left.
 *
 * ## Why there is a ceiling
 *
 * `api/github/webhook` was built with no cost guard because nothing on that
 * path called a model, and its own docstring says a correction step would put
 * the run back to being a sum of model calls. This is that step. The ceiling
 * is the honest version of "it will probably fit": past it the planner refuses
 * and says so, rather than starting work that a function timeout will throw
 * away half-done — the failure `lib/runs/resume.ts` exists because of.
 */

/** One string to translate: a key missing from one locale. */
export interface CorrectionUnit {
  locale: string;
  /** Flattened key, namespace prefix included — `common:app.title`. */
  key: string;
  /** The source-locale text. Never empty: a unit without one is dropped. */
  sourceText: string;
}

export interface CorrectionPlan {
  units: CorrectionUnit[];
  /** Locales the plan touches, in a stable order. */
  locales: string[];
  /**
   * Findings deliberately not corrected, by kind. Reported so the caller can
   * say what is still waiting for a person rather than implying it fixed
   * everything.
   */
  leftAlone: Finding[];
  /** Set when nothing will be attempted. Null when there is work to do. */
  refusal: string | null;
}

/**
 * Translation units a single delivery may spend.
 *
 * Sized against what this path actually sees rather than a round number: the
 * supported case is a handful of keys across the locales a repository ships,
 * and the fixture's seven locales make 7 units per key. Forty is therefore
 * five or six keys at once — past that a pull request is a bulk import, which
 * is a different job and should not be done inside a webhook.
 */
export const MAX_CORRECTION_UNITS = 40;

export function planCorrection(args: {
  report: AuditReport;
  /** Flattened catalogues from the head checkout, keyed by locale. */
  catalogues: Readonly<Record<string, Readonly<Record<string, string>>>>;
  sourceLocale: string;
  maxUnits?: number;
}): CorrectionPlan {
  const max = args.maxUnits ?? MAX_CORRECTION_UNITS;
  const source = args.catalogues[args.sourceLocale] ?? {};

  const correctable: CorrectionUnit[] = [];
  const leftAlone: Finding[] = [];

  for (const finding of args.report.findings) {
    if (finding.kind !== 'missing-translation' || !finding.locale) {
      leftAlone.push(finding);
      continue;
    }

    const sourceText = source[finding.key];
    if (typeof sourceText !== 'string' || sourceText.length === 0) {
      /*
       * The audit said the source defines this key, so an empty one here means
       * the two disagree. Left alone rather than translated from nothing: an
       * empty string would be written into the catalogue as a real value and
       * the check would go green over a key nobody can read.
       */
      leftAlone.push(finding);
      continue;
    }

    correctable.push({ locale: finding.locale, key: finding.key, sourceText });
  }

  if (correctable.length === 0) {
    return {
      units: [],
      locales: [],
      leftAlone,
      refusal:
        leftAlone.length > 0
          ? 'Nothing here is safe to correct automatically.'
          : 'No findings to correct.',
    };
  }

  if (correctable.length > max) {
    return {
      units: [],
      locales: [],
      leftAlone: args.report.findings,
      refusal: `${correctable.length} translations are missing, over the ${max} this corrects in one pass.`,
    };
  }

  const locales = [...new Set(correctable.map((u) => u.locale))].sort();
  return { units: correctable, locales, leftAlone, refusal: null };
}

/**
 * The same catalogues with the accepted translations written in.
 *
 * Flattened, and only for re-auditing — the files on disk are written by
 * `catalogue-file.ts`, which edits the real JSON rather than regenerating it.
 * Two representations, one of which never reaches a commit.
 *
 * A key already present is never overwritten. The planner only produces units
 * for keys the audit called missing, so this cannot fire in practice; it is
 * here because "preserve existing translations" is the property that must hold
 * even if the planner is wrong, and an assertion placed where the write
 * happens is worth more than one placed where the decision is made.
 */
export function applyTranslations(
  catalogues: Readonly<Record<string, Readonly<Record<string, string>>>>,
  translations: readonly (CorrectionUnit & { text: string })[],
): Record<string, Record<string, string>> {
  const next: Record<string, Record<string, string>> = {};
  for (const [locale, catalogue] of Object.entries(catalogues)) {
    next[locale] = { ...catalogue };
  }
  for (const t of translations) {
    let target = next[t.locale];
    if (!target) {
      target = {};
      next[t.locale] = target;
    }
    if (typeof target[t.key] === 'string') continue;
    target[t.key] = t.text;
  }
  return next;
}

/**
 * Which translations the audit accepts, judged by re-running the audit.
 *
 * Deliberately not a second implementation of the placeholder and ICU checks.
 * `packages/eval` already decides what a bad translation is, and a correction
 * validated by a copy of those rules would be two tallies free to disagree —
 * the failure this repository has recorded more than once. So the corrected
 * catalogues go back through `auditI18n`, and a unit is accepted only when the
 * function that reported the problem reports nothing about it.
 *
 * A translation that arrives with a dropped `{{name}}` is therefore rejected
 * here rather than committed and re-reported by the next check.
 */
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

export function acceptedTranslations(args: {
  before: AuditReport;
  after: AuditReport;
  candidates: readonly (CorrectionUnit & { text: string })[];
}): {
  accepted: (CorrectionUnit & { text: string })[];
  rejected: { unit: CorrectionUnit; reason: string }[];
} {
  const problemAfter = new Map<string, Finding>();
  for (const f of args.after.findings) {
    if (f.locale) problemAfter.set(tupleKey(f.locale, f.key), f);
  }

  const accepted: (CorrectionUnit & { text: string })[] = [];
  const rejected: { unit: CorrectionUnit; reason: string }[] = [];

  for (const candidate of args.candidates) {
    const still = problemAfter.get(tupleKey(candidate.locale, candidate.key));
    if (still) {
      rejected.push({ unit: candidate, reason: still.detail });
      continue;
    }
    accepted.push(candidate);
  }

  return { accepted, rejected };
}

/**
 * Whether `/v1/open-pr` will accept writes to this catalogue directory.
 *
 * That route's path allow-list requires the first segment to be exactly
 * `locales`, because its only legitimate purpose is writing locale files and
 * a denylist would still let a caller steer it at `.github/workflows`. The
 * loader, meanwhile, also finds catalogues in `public/locales` and
 * `src/locales`.
 *
 * So a repository can be analysed and still not be correctable, and this is
 * where that is said out loud rather than discovered as a 400 from the API
 * after the translations have been paid for.
 */
export function correctableDirectory(cataloguesDir: string): boolean {
  return cataloguesDir === 'locales';
}
