import type { ScoreComponent } from './pain.js';
import type { RepoSnapshot } from './signals.js';

/**
 * Fit against one specific ICP: a team that could be a Layersky design
 * partner this quarter.
 *
 * ## Why not `scoreIcp`
 *
 * `scoreIcp` answers "does this company have a localisation problem", which
 * is the right question for a market and the wrong one for five design
 * partners. It weights locale count and commit activity heavily and says
 * nothing about the two facts that decide whether Layersky can help *today*:
 * which i18n library they use, and whether they already bought a TMS.
 *
 * It is left untouched. Scores already stored carry the weights that produced
 * them (`closer_scores.weights`), and re-pointing the function underneath
 * them would make two numbers out of a hundred incomparable while both still
 * looked like scores.
 *
 * ## The two rules inherited from `scoreIcp`, because they were right
 *
 * No component awards points without naming the observation that earned them,
 * and **a component with no evidence scores zero and says so** rather than
 * being dropped. A score silently computed out of seventy and presented out
 * of a hundred makes every company look worse than it is by exactly the
 * amount nobody measured.
 *
 * ## The one rule that is new: a disqualifier is not a low score
 *
 * A team running Crowdin has not scored badly on "no TMS". They have bought
 * the category, and the correct next action is `not_a_fit` with the config
 * file as evidence — not a slightly shorter queue position. Mixing the two
 * produces a ranked list whose top entries are unreachable, which is how a
 * prospect list starts wasting the only thing design-partner acquisition has,
 * which is attention.
 *
 * So `disqualifiers` is a separate array from `breakdown`, and a disqualified
 * company still gets a score — because the score is what tells you whether to
 * revisit it when the disqualifier goes away.
 */

/* ------------------------------------------------------------------ *
 * Translation management systems
 * ------------------------------------------------------------------ */

/**
 * The seven a repository can show without anybody being asked.
 *
 * Config files first, dependencies second, and both are listed because they
 * fail differently: a team can have `crowdin.yml` committed and the CLI
 * installed globally (no dependency), or pull a client library into a sync
 * script with no config in the repository root.
 *
 * Matched on the **basename** rather than the full path, because these files
 * live wherever the sync script runs from — `crowdin.yml`, `.crowdin.yml` and
 * `tooling/i18n/crowdin.yaml` are all the same fact.
 */
const TMS_CONFIG: Record<string, string> = {
  'crowdin.yml': 'Crowdin',
  'crowdin.yaml': 'Crowdin',
  '.crowdin.yml': 'Crowdin',
  '.crowdin.yaml': 'Crowdin',
  'lokalise.yml': 'Lokalise',
  'lokalise.yaml': 'Lokalise',
  '.lokalise.yml': 'Lokalise',
  '.phrase.yml': 'Phrase',
  'phrase.yml': 'Phrase',
  '.phraseapp.yml': 'Phrase',
  '.transifexrc': 'Transifex',
  'transifex.yml': 'Transifex',
  '.tx': 'Transifex',
  '.weblate': 'Weblate',
  'weblate.yml': 'Weblate',
  'smartling.yml': 'Smartling',
  'smartling.yaml': 'Smartling',
  '.tolgeerc': 'Tolgee',
  'tolgee.config.json': 'Tolgee',
};

const TMS_DEPENDENCY: Record<string, string> = {
  '@crowdin/cli': 'Crowdin',
  '@crowdin/crowdin-api-client': 'Crowdin',
  '@lokalise/node-api': 'Lokalise',
  'lokalise-cli': 'Lokalise',
  '@phrase/cli': 'Phrase',
  'phrase-js': 'Phrase',
  transifex: 'Transifex',
  '@transifex/cli': 'Transifex',
  '@transifex/native': 'Transifex',
  'smartling-api-sdk-nodejs': 'Smartling',
  '@tolgee/cli': 'Tolgee',
  '@tolgee/react': 'Tolgee',
  '@tolgee/core': 'Tolgee',
};

export interface TmsFinding {
  vendor: string;
  /** What was seen: a path, or a dependency name. */
  evidence: string;
  kind: 'config' | 'dependency';
}

function basename(path: string): string {
  const parts = path.split('/').filter(Boolean);
  return (parts[parts.length - 1] ?? '').toLowerCase();
}

/**
 * Which translation management systems this repository shows, if any.
 *
 * Deduplicated by vendor **and** evidence, so a monorepo with four
 * `crowdin.yml` files reports Crowdin once per distinct path rather than
 * four identical findings — the operator needs to know it is wired, not how
 * many packages wired it.
 */
export function detectTms(snapshot: RepoSnapshot): TmsFinding[] {
  const found: TmsFinding[] = [];
  const seen = new Set<string>();

  for (const path of snapshot.paths) {
    const vendor = TMS_CONFIG[basename(path)];
    if (!vendor) continue;
    const key = `${vendor}:${path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    found.push({ vendor, evidence: path, kind: 'config' });
  }

  for (const dependency of snapshot.dependencies) {
    const vendor = TMS_DEPENDENCY[dependency];
    if (!vendor) continue;
    const key = `${vendor}:${dependency}`;
    if (seen.has(key)) continue;
    seen.add(key);
    found.push({ vendor, evidence: dependency, kind: 'dependency' });
  }

  return found;
}

/* ------------------------------------------------------------------ *
 * The i18n library, and what the product can do about it
 * ------------------------------------------------------------------ */

/**
 * How well the check can read this repository today.
 *
 * Three answers, not two, because "a multilingual product on the wrong
 * library" and "not a multilingual product" need opposite decisions. The
 * first is a design partner waiting on next-intl support; the second is not
 * this ICP at all.
 */
export type LibraryFit = 'supported' | 'detected_unsupported' | 'none';

/** Signal labels `detectLocalizationSignals` emits for i18next. */
const SUPPORTED_LABELS = new Set(['i18next', 'react-i18next', 'next-i18next']);

/**
 * Libraries the check recognises and answers "not supported" to — which is a
 * different and more useful answer than silence, and a different prospect
 * from one with no localisation at all.
 */
const UNSUPPORTED_LABELS = new Set([
  'next-intl',
  'react-intl',
  '@formatjs/intl',
  'vue-i18n',
  '@lingui/core',
  'svelte-i18n',
  'react-intl-universal',
  'angular-translate',
  'node-polyglot',
  'globalize',
  'i18n-js',
]);

export function libraryFit(signalLabels: readonly string[]): {
  fit: LibraryFit;
  library: string | null;
} {
  for (const label of signalLabels) {
    if (SUPPORTED_LABELS.has(label))
      return { fit: 'supported', library: label };
  }
  for (const label of signalLabels) {
    if (UNSUPPORTED_LABELS.has(label)) {
      return { fit: 'detected_unsupported', library: label };
    }
  }
  return { fit: 'none', library: null };
}

/* ------------------------------------------------------------------ *
 * The score
 * ------------------------------------------------------------------ */

export interface DesignPartnerWeights {
  libraryFit: number;
  teamSize: number;
  localeCount: number;
  localizationPain: number;
  engineeringActivity: number;
  saasB2b: number;
}

/**
 * Weighted for one quarter's goal: five teams Layersky can help *now*.
 *
 * `libraryFit` is the heaviest because it is the only component that decides
 * whether the product functions at all — the check reads i18next catalogues
 * and says "not supported" to everything else. `teamSize` is second because
 * the ICP band is 5–40 developers and both ends of that are real: below it
 * there is no coordination problem to solve, above it there is already a
 * localisation owner and probably a TMS.
 *
 * Stored alongside every score, like `DEFAULT_ICP_WEIGHTS`, so a score
 * computed under one set stays readable after they change.
 */
export const DESIGN_PARTNER_WEIGHTS: DesignPartnerWeights = {
  libraryFit: 25,
  teamSize: 20,
  localeCount: 15,
  localizationPain: 15,
  engineeringActivity: 15,
  saasB2b: 10,
};

/**
 * The band, named here rather than inlined in the arithmetic below.
 *
 * `MIN` is where a second person starts having to coordinate with a first.
 * `MAX` is where a dedicated localisation owner usually appears, and with
 * them a TMS — which is the disqualifier, so the upper bound and the
 * disqualifier are describing the same boundary from two directions.
 */
export const TEAM_BAND = { min: 5, max: 40 } as const;

/**
 * Whether an operator confirmed the company sells B2B SaaS, with a source.
 *
 * **There is no automatic path to this.** It cannot be read from a
 * repository, and the one previous time something in this project inferred a
 * fact about a person from a weak signal — reading an email domain as
 * evidence of a third-party signup — it was written down as a fact and was
 * wrong. So the only way to set it is an operator pasting a URL, and the
 * absence of one is reported as "not assessed" rather than guessed in either
 * direction.
 *
 * `note` and `confirmedAt` exist so the claim ages visibly. A company that
 * was B2B SaaS eighteen months ago may not be, and a confirmation with no
 * date cannot be questioned.
 */
export interface SaasB2bAssertion {
  sourceUrl: string;
  note: string;
  confirmedAt: string;
}

export interface DesignPartnerInputs {
  /** Signal labels from `detectLocalizationSignals`. */
  signalLabels: readonly string[];
  /** Distinct locales the repository ships. */
  localeCount: number;
  /**
   * Distinct commit authors over the trailing window.
   *
   * A property of the **repository**, not of the company, and named that way
   * everywhere it is shown. A company with forty engineers and one
   * open-source repository reads as one contributor here, and that is a
   * limitation of the proxy rather than a fact about the team.
   */
  distinctContributors: number | null;
  contributorWindowDays: number;
  commitsInWindow: number;
  commitWindowDays: number;
  /** 0–100, from `painScore`. */
  painValue: number;
  /** Mean confidence of the pain evidence, 0–1. */
  painConfidence: number;
  /** What the repository shows, from `detectTms`. */
  tms: readonly TmsFinding[];
  /** Null unless an operator confirmed it with a source. */
  saasB2b: SaasB2bAssertion | null;
}

export interface Disqualifier {
  label: string;
  summary: string;
  /** What was seen, so the verdict can be re-checked rather than believed. */
  evidence: string[];
}

export interface DesignPartnerFit {
  /** Points earned, 0–100. Sums the breakdown exactly. */
  value: number;
  /** Points that could be assessed at all, given what was collected. */
  assessable: number;
  confidence: number;
  breakdown: ScoreComponent[];
  notAssessed: string[];
  /**
   * Reasons this is not the ICP, whatever the score says. Non-empty means
   * `not_a_fit`, not "further down the queue".
   */
  disqualifiers: Disqualifier[];
  /** Convenience for callers; `disqualifiers.length === 0`. */
  qualifies: boolean;
}

/** Points on a scale, rounded, never above the maximum. */
function scale(fraction: number, max: number): number {
  return Math.min(max, Math.round(Math.max(0, fraction) * max));
}

/**
 * How far outside the band, as a fraction that decays rather than a cliff.
 *
 * A four-person team is nearly the ICP and a one-person repository is not;
 * scoring both zero would throw away the difference. Below the band the
 * fraction is `contributors / min`, so four of five scores 80%. Above it the
 * penalty is gentler — a 60-contributor repository is still a team with a
 * coordination problem, it is just likelier to have solved it already, and
 * the TMS disqualifier is the sharper instrument for that case.
 */
function teamFraction(contributors: number): number {
  if (contributors >= TEAM_BAND.min && contributors <= TEAM_BAND.max) return 1;
  if (contributors < TEAM_BAND.min) return contributors / TEAM_BAND.min;
  return Math.max(0.25, TEAM_BAND.max / contributors);
}

export function scoreDesignPartnerFit(
  inputs: DesignPartnerInputs,
  weights: DesignPartnerWeights = DESIGN_PARTNER_WEIGHTS,
): DesignPartnerFit {
  const breakdown: ScoreComponent[] = [];
  const notAssessed: string[] = [];
  const disqualifiers: Disqualifier[] = [];

  /* ---- Library fit -------------------------------------------------- */

  const library = libraryFit(inputs.signalLabels);
  /*
   * Partial credit at a third, not a half.
   *
   * A next-intl team is a genuine prospect for the quarter *after* next-intl
   * ships, and ranking them close to an i18next team would fill a list of
   * five with companies the product cannot check. A third is enough to keep
   * them visible and not enough to crowd out somebody reachable today.
   */
  const libraryPoints =
    library.fit === 'supported'
      ? weights.libraryFit
      : library.fit === 'detected_unsupported'
        ? Math.round(weights.libraryFit / 3)
        : 0;
  breakdown.push({
    component: 'library_fit',
    points: libraryPoints,
    max: weights.libraryFit,
    why:
      library.fit === 'supported'
        ? `Uses ${library.library}, which the check reads today`
        : library.fit === 'detected_unsupported'
          ? `Uses ${library.library}, which the check detects and declares unsupported`
          : 'No i18n library detected',
  });

  /* ---- Team size proxy ---------------------------------------------- */

  if (inputs.distinctContributors === null) {
    breakdown.push({
      component: 'team_size_proxy',
      points: 0,
      max: weights.teamSize,
      why: 'Not assessed — contributor list was not collected',
    });
    notAssessed.push('team_size_proxy');
  } else {
    const contributors = inputs.distinctContributors;
    breakdown.push({
      component: 'team_size_proxy',
      points: scale(teamFraction(contributors), weights.teamSize),
      max: weights.teamSize,
      why: `${contributors} distinct contributors, ${inputs.contributorWindowDays}d (proxy for a ${TEAM_BAND.min}–${TEAM_BAND.max} developer team; a repository count, not a headcount)`,
    });
  }

  /* ---- Locales ------------------------------------------------------- */

  /*
   * Full marks at six, where `scoreIcp` uses eight.
   *
   * The guardrail's value is proportional to the number of languages a single
   * forgotten key breaks, and six is already six findings on one pull
   * request. Beyond that it is the same problem, larger.
   */
  breakdown.push({
    component: 'locale_count',
    points: scale(inputs.localeCount / 6, weights.localeCount),
    max: weights.localeCount,
    why: `${inputs.localeCount} locale(s)`,
  });

  /* ---- Pain ---------------------------------------------------------- */

  breakdown.push({
    component: 'localization_pain',
    points: scale(inputs.painValue / 100, weights.localizationPain),
    max: weights.localizationPain,
    why:
      inputs.painValue > 0
        ? `pain score ${inputs.painValue}/100`
        : 'no evidence of translation friction',
  });

  /* ---- Activity ------------------------------------------------------ */

  breakdown.push({
    component: 'engineering_activity',
    points: scale(inputs.commitsInWindow / 30, weights.engineeringActivity),
    max: weights.engineeringActivity,
    why: `${inputs.commitsInWindow} commit(s) in ${inputs.commitWindowDays} days`,
  });

  /* ---- SaaS B2B, operator-confirmed or not at all -------------------- */

  if (inputs.saasB2b === null) {
    breakdown.push({
      component: 'saas_b2b',
      points: 0,
      max: weights.saasB2b,
      why: 'Not assessed — no operator confirmation; this cannot be read from a repository',
    });
    notAssessed.push('saas_b2b');
  } else {
    breakdown.push({
      component: 'saas_b2b',
      points: weights.saasB2b,
      max: weights.saasB2b,
      why: `Confirmed by an operator on ${inputs.saasB2b.confirmedAt}: ${inputs.saasB2b.note} (${inputs.saasB2b.sourceUrl})`,
    });
  }

  /* ---- Disqualifiers, separate from all of the above ------------------ */

  if (inputs.tms.length > 0) {
    const vendors = [...new Set(inputs.tms.map((f) => f.vendor))].sort();
    disqualifiers.push({
      label: 'tms_in_use',
      summary: `${vendors.join(', ')} ${vendors.length === 1 ? 'is' : 'are'} already wired into this repository. They have bought the category; the useful move is to learn why, not to pitch.`,
      evidence: inputs.tms.map((f) => `${f.kind}: ${f.evidence}`),
    });
  }

  /*
   * Not multilingual, which is a harder no than a low locale count.
   *
   * Two locales is the floor for the product to say anything at all: with
   * one, there is no second catalogue to be missing a key. A repository with
   * no library *and* fewer than two locales is not an early-stage prospect,
   * it is a different company.
   */
  if (library.fit === 'none' && inputs.localeCount < 2) {
    disqualifiers.push({
      label: 'not_multilingual',
      summary:
        'No i18n library and fewer than two locales. There is no second catalogue for a key to be missing from, so the check has nothing to report.',
      evidence: [`${inputs.localeCount} locale(s)`, 'no i18n library detected'],
    });
  }

  const value = breakdown.reduce((total, c) => total + c.points, 0);
  const assessable = breakdown
    .filter((c) => !notAssessed.includes(c.component))
    .reduce((total, c) => total + c.max, 0);

  /*
   * Confidence is about the inputs, not the arithmetic.
   *
   * Library, locales, contributors and commits are read directly and are
   * certain. Pain carries whatever confidence its evidence had, and the
   * operator's SaaS assertion is certain in the sense that matters here — a
   * person looked at a page and said so, which is the strongest kind of
   * evidence this system handles.
   */
  const painPoints =
    breakdown.find((c) => c.component === 'localization_pain')?.points ?? 0;
  const certainPoints = value - painPoints;
  const confidence =
    value === 0
      ? 0
      : (certainPoints + painPoints * (inputs.painConfidence || 0)) / value;

  return {
    value,
    assessable,
    confidence: Number(confidence.toFixed(3)),
    breakdown,
    notAssessed,
    disqualifiers,
    qualifies: disqualifiers.length === 0,
  };
}
