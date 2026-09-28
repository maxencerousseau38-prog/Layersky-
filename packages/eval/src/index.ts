/**
 * The open evaluation core, as something another package can actually import.
 *
 * `packages/eval` had no entry point and no `main`: everything in it was
 * reachable only as a script run from its own directory. CLAUDE.md says the
 * open core must be usable on its own, and it was not — the first consumer
 * outside this package had nowhere to import from.
 *
 * What is exported is the part that is genuinely reusable: the deterministic
 * checks and the corpus they run against. The condition A/B pipeline stays
 * internal, because it encodes one experiment rather than a general facility.
 */

export {
  extractPlaceholders,
  placeholdersIntact,
  type PlaceholderSyntax,
  type PlaceholderToken,
} from './deterministic/placeholders.js';
export { isIcuMessage, validateIcu } from './deterministic/icu.js';
export { chrf, exactMatch, type ChrfScore } from './deterministic/chrf.js';
export {
  expectedPluralCategories,
  pluralCategoriesCorrect,
} from './deterministic/plurals.js';
export { lengthOverflow } from './deterministic/length.js';
export {
  checkGlossaryConsistency,
  type GlossaryHit,
} from './deterministic/glossary.js';
export { scoreTranslation } from './deterministic/score.js';
export { loadCorpus, loadGlossary, CORPUS_DATA_DIR } from './corpus/load.js';
export * from './audit/index.js';
export * from './ambiguity/build.js';
export * from './ambiguity/cases.js';
export * from './ambiguity/score.js';
export * from './ambiguity/split.js';
export * from './ambiguity/holdout.js';
