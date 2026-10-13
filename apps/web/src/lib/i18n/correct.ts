import type { AuditReport, Finding } from '@localize-infra/eval';
import { CORRECTABLE_LOCALE_DIRS } from '@localize-infra/schemas';

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
  /**
   * Keys this pull request added to the source locale (`addedCatalogueKeys`).
   *
   * Required, not defaulted: the only case the correction supports is a key
   * added here and missing from targets. Without it, every missing translation
   * in scope was corrected — and on real repositories 6 of 7 planned
   * corrections were the repository's backlog, translated on a pull request
   * that never touched those keys or those languages.
   */
  addedSourceKeys: readonly string[];
  maxUnits?: number;
}): CorrectionPlan {
  const max = args.maxUnits ?? MAX_CORRECTION_UNITS;
  const source = args.catalogues[args.sourceLocale] ?? {};
  const added = new Set(args.addedSourceKeys);

  /*
   * Nothing is corrected while a catalogue does not parse — not even the
   * languages that do. The broken file is the pull request's real problem and
   * the one message its author has to act on; a corrective pull request
   * adding translations around it would spend the workspace's budget on the
   * wrong thing and bury that message. Refused here, which is before anything
   * is charged.
   */
  const unreadable = args.report.unreadableCatalogues ?? [];
  if (unreadable.length > 0) {
    return {
      units: [],
      locales: [],
      leftAlone: args.report.findings,
      refusal: `${unreadable.map((path) => `\`${path}\``).join(', ')} ${unreadable.length === 1 ? 'is' : 'are'} not valid JSON. Nothing is corrected until ${unreadable.length === 1 ? 'it parses' : 'they parse'}.`,
    };
  }

  const correctable: CorrectionUnit[] = [];
  const leftAlone: Finding[] = [];
  let backlog = 0;

  for (const finding of args.report.findings) {
    if (finding.kind !== 'missing-translation' || !finding.locale) {
      leftAlone.push(finding);
      continue;
    }

    if (!added.has(finding.key)) {
      // Missing from before this pull request: reported, not corrected here.
      leftAlone.push(finding);
      backlog += 1;
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
        backlog > 0 && backlog === leftAlone.length
          ? 'The missing translations are for keys this pull request did not add, so they are left for a person.'
          : leftAlone.length > 0
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
 * Read from the route's own allow-list, `CORRECTABLE_LOCALE_DIRS`, rather than
 * kept here as a second copy. It was the literal `locales` while the loader
 * also reads `public/locales` and `src/locales`, so on every real repository
 * measured the analysis ran and the correction never could.
 *
 * Still asked before anything is spent: a directory outside the list is
 * refused with a sentence, rather than discovered as a 400 from the API after
 * the translations have been paid for. **The API must be deployed with the
 * widened list before this side is** — `apps/api` does not deploy on merge.
 */
export function correctableDirectory(cataloguesDir: string): boolean {
  return (CORRECTABLE_LOCALE_DIRS as readonly string[]).includes(cataloguesDir);
}
