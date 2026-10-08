import { describe, expect, it } from 'vitest';
import {
  DESIGN_PARTNER_WEIGHTS,
  type DesignPartnerInputs,
  TEAM_BAND,
  detectTms,
  libraryFit,
  scoreDesignPartnerFit,
} from './design-partner.js';

/** A repository that is squarely the ICP, so each test can move one thing. */
const IDEAL: DesignPartnerInputs = {
  signalLabels: ['i18next', 'react-i18next'],
  localeCount: 6,
  distinctContributors: 12,
  contributorWindowDays: 90,
  commitsInWindow: 40,
  commitWindowDays: 90,
  painValue: 60,
  painConfidence: 0.8,
  tms: [],
  saasB2b: null,
};

describe('detectTms', () => {
  it('finds a config file wherever it lives', () => {
    const found = detectTms({
      paths: ['tooling/i18n/crowdin.yaml'],
      dependencies: [],
    });
    expect(found).toEqual([
      {
        vendor: 'Crowdin',
        evidence: 'tooling/i18n/crowdin.yaml',
        kind: 'config',
      },
    ]);
  });

  /*
   * The two detectors fail differently and that is why both exist: a team can
   * commit `crowdin.yml` with the CLI installed globally, or pull a client
   * library into a sync script with no config at the repository root.
   */
  it('finds a client library with no config file', () => {
    const found = detectTms({
      paths: ['src/index.ts'],
      dependencies: ['@lokalise/node-api', 'react'],
    });
    expect(found).toEqual([
      {
        vendor: 'Lokalise',
        evidence: '@lokalise/node-api',
        kind: 'dependency',
      },
    ]);
  });

  it('reports a vendor once per distinct piece of evidence, not once per file', () => {
    const found = detectTms({
      paths: ['crowdin.yml', 'crowdin.yml', 'packages/web/crowdin.yml'],
      dependencies: [],
    });
    expect(found).toHaveLength(2);
    expect(new Set(found.map((f) => f.vendor))).toEqual(new Set(['Crowdin']));
  });

  it('is quiet about a repository with no TMS', () => {
    expect(
      detectTms({ paths: ['locales/en.json'], dependencies: ['i18next'] }),
    ).toEqual([]);
  });

  /*
   * `.transifexrc` and `.tx` are dotfiles and `basename` lowercases, so a
   * path like `.TX/config` must still match. Pinned because a case-sensitive
   * comparison here would silently stop detecting one vendor.
   */
  it('matches case-insensitively', () => {
    const found = detectTms({ paths: ['CROWDIN.YML'], dependencies: [] });
    expect(found[0]?.vendor).toBe('Crowdin');
  });
});

describe('libraryFit', () => {
  it('reads i18next as supported', () => {
    expect(libraryFit(['react-i18next'])).toEqual({
      fit: 'supported',
      library: 'react-i18next',
    });
  });

  it('prefers a supported library over an unsupported one in the same repository', () => {
    // A migration in progress. The check works today on the i18next half,
    // so the answer is "supported" rather than an average of the two.
    expect(libraryFit(['next-intl', 'i18next']).fit).toBe('supported');
  });

  it('distinguishes a detected-but-unsupported library from none at all', () => {
    expect(libraryFit(['next-intl'])).toEqual({
      fit: 'detected_unsupported',
      library: 'next-intl',
    });
    expect(libraryFit(['locale-directory'])).toEqual({
      fit: 'none',
      library: null,
    });
  });
});

describe('scoreDesignPartnerFit', () => {
  it('sums its breakdown exactly', () => {
    const fit = scoreDesignPartnerFit(IDEAL);
    const summed = fit.breakdown.reduce((total, c) => total + c.points, 0);
    expect(fit.value).toBe(summed);
  });

  it('never exceeds a component maximum', () => {
    const fit = scoreDesignPartnerFit({
      ...IDEAL,
      localeCount: 40,
      commitsInWindow: 5000,
      painValue: 100,
    });
    for (const component of fit.breakdown) {
      expect(component.points).toBeLessThanOrEqual(component.max);
    }
    expect(fit.value).toBeLessThanOrEqual(100);
  });

  it('weights sum to one hundred, so a score reads as a percentage', () => {
    const total = Object.values(DESIGN_PARTNER_WEIGHTS).reduce(
      (sum, weight) => sum + weight,
      0,
    );
    expect(total).toBe(100);
  });

  /* ---- Library fit ---- */

  it('pays full marks for i18next and a third for a library the check cannot read', () => {
    const supported = scoreDesignPartnerFit(IDEAL);
    const unsupported = scoreDesignPartnerFit({
      ...IDEAL,
      signalLabels: ['next-intl'],
    });

    const points = (fit: typeof supported) =>
      fit.breakdown.find((c) => c.component === 'library_fit')?.points;

    expect(points(supported)).toBe(DESIGN_PARTNER_WEIGHTS.libraryFit);
    expect(points(unsupported)).toBe(
      Math.round(DESIGN_PARTNER_WEIGHTS.libraryFit / 3),
    );
    // Visible, not crowding out somebody reachable today.
    expect(points(unsupported)).toBeLessThan(points(supported) as number);
    expect(points(unsupported)).toBeGreaterThan(0);
  });

  it('names the library in the reason, so the number can be argued with', () => {
    const fit = scoreDesignPartnerFit(IDEAL);
    const why = fit.breakdown.find((c) => c.component === 'library_fit')?.why;
    expect(why).toContain('i18next');
  });

  /* ---- Team size proxy ---- */

  it('pays full marks across the whole band and decays outside it', () => {
    const at = (contributors: number) =>
      scoreDesignPartnerFit({
        ...IDEAL,
        distinctContributors: contributors,
      }).breakdown.find((c) => c.component === 'team_size_proxy')?.points ?? -1;

    expect(at(TEAM_BAND.min)).toBe(DESIGN_PARTNER_WEIGHTS.teamSize);
    expect(at(20)).toBe(DESIGN_PARTNER_WEIGHTS.teamSize);
    expect(at(TEAM_BAND.max)).toBe(DESIGN_PARTNER_WEIGHTS.teamSize);

    // Nearly the ICP scores nearly full; a solo repository does not.
    expect(at(4)).toBeGreaterThan(at(1));
    expect(at(4)).toBeLessThan(DESIGN_PARTNER_WEIGHTS.teamSize);
    expect(at(200)).toBeLessThan(DESIGN_PARTNER_WEIGHTS.teamSize);
  });

  /*
   * The proxy must say it is a proxy. An operator reading "12 developers"
   * off a repository count would be reading a fact that was never measured,
   * which is the specific mistake this project has made before.
   */
  it('labels the contributor count as a repository measure, not a headcount', () => {
    const why =
      scoreDesignPartnerFit(IDEAL).breakdown.find(
        (c) => c.component === 'team_size_proxy',
      )?.why ?? '';
    expect(why).toContain('distinct contributors, 90d');
    expect(why).toMatch(/not a headcount/i);
  });

  it('reports the team proxy as not assessed when no contributor list was collected', () => {
    const fit = scoreDesignPartnerFit({ ...IDEAL, distinctContributors: null });
    const component = fit.breakdown.find(
      (c) => c.component === 'team_size_proxy',
    );

    expect(component?.points).toBe(0);
    expect(component?.why).toMatch(/not assessed/i);
    expect(fit.notAssessed).toContain('team_size_proxy');
    // Still listed with its maximum, so the gap is visible rather than hidden.
    expect(component?.max).toBe(DESIGN_PARTNER_WEIGHTS.teamSize);
  });

  /* ---- SaaS B2B ---- */

  it('never awards SaaS B2B without an operator saying so', () => {
    const fit = scoreDesignPartnerFit(IDEAL);
    const component = fit.breakdown.find((c) => c.component === 'saas_b2b');

    expect(component?.points).toBe(0);
    expect(component?.why).toMatch(/not assessed/i);
    expect(component?.why).toMatch(/cannot be read from a repository/i);
    expect(fit.notAssessed).toContain('saas_b2b');
  });

  it('awards it on an operator assertion and quotes the source back', () => {
    const fit = scoreDesignPartnerFit({
      ...IDEAL,
      saasB2b: {
        sourceUrl: 'https://example.com/pricing',
        note: 'Per-seat pricing page aimed at teams',
        confirmedAt: '2026-10-04',
      },
    });
    const component = fit.breakdown.find((c) => c.component === 'saas_b2b');

    expect(component?.points).toBe(DESIGN_PARTNER_WEIGHTS.saasB2b);
    expect(component?.why).toContain('https://example.com/pricing');
    expect(component?.why).toContain('2026-10-04');
    expect(fit.notAssessed).not.toContain('saas_b2b');
  });

  /* ---- Assessable ---- */

  /*
   * The number that stops a score out of seventy being read as a score out of
   * a hundred. `scoreIcp` added this for the same reason and it is the one
   * piece of its arithmetic worth copying exactly.
   */
  it('reports only what could be assessed as assessable', () => {
    const blind = scoreDesignPartnerFit({
      ...IDEAL,
      distinctContributors: null,
      saasB2b: null,
    });
    expect(blind.assessable).toBe(
      100 - DESIGN_PARTNER_WEIGHTS.teamSize - DESIGN_PARTNER_WEIGHTS.saasB2b,
    );

    const full = scoreDesignPartnerFit({
      ...IDEAL,
      saasB2b: {
        sourceUrl: 'https://example.com',
        note: 'n',
        confirmedAt: '2026-10-04',
      },
    });
    expect(full.assessable).toBe(100);
    expect(full.notAssessed).toEqual([]);
  });

  /* ---- Disqualifiers ---- */

  it('disqualifies a repository with a TMS and still scores it', () => {
    const fit = scoreDesignPartnerFit({
      ...IDEAL,
      tms: [{ vendor: 'Crowdin', evidence: 'crowdin.yml', kind: 'config' }],
    });

    expect(fit.qualifies).toBe(false);
    expect(fit.disqualifiers.map((d) => d.label)).toEqual(['tms_in_use']);
    expect(fit.disqualifiers[0]?.evidence).toEqual(['config: crowdin.yml']);

    /*
     * The score survives, and that is the point of keeping the two apart: it
     * is what tells you whether to come back if they drop the TMS. A system
     * that zeroed the score would throw that away.
     */
    expect(fit.value).toBe(scoreDesignPartnerFit(IDEAL).value);
  });

  it('does not deduct points for a TMS', () => {
    const withTms = scoreDesignPartnerFit({
      ...IDEAL,
      tms: [{ vendor: 'Phrase', evidence: '@phrase/cli', kind: 'dependency' }],
    });
    for (const component of withTms.breakdown) {
      expect(component.why).not.toMatch(/phrase/i);
    }
  });

  it('names every vendor once in the disqualifier summary', () => {
    const fit = scoreDesignPartnerFit({
      ...IDEAL,
      tms: [
        { vendor: 'Crowdin', evidence: 'crowdin.yml', kind: 'config' },
        { vendor: 'Crowdin', evidence: '@crowdin/cli', kind: 'dependency' },
        { vendor: 'Phrase', evidence: 'phrase.yml', kind: 'config' },
      ],
    });
    const summary = fit.disqualifiers[0]?.summary ?? '';
    expect(summary).toContain('Crowdin, Phrase');
    expect(summary.match(/Crowdin/g)).toHaveLength(1);
    // Every piece of evidence is kept, so the verdict can be re-checked.
    expect(fit.disqualifiers[0]?.evidence).toHaveLength(3);
  });

  it('disqualifies a repository that is not multilingual at all', () => {
    const fit = scoreDesignPartnerFit({
      ...IDEAL,
      signalLabels: [],
      localeCount: 1,
    });
    expect(fit.disqualifiers.map((d) => d.label)).toEqual(['not_multilingual']);
  });

  /*
   * One locale and a library is a team that set i18n up and has not shipped a
   * second language yet — early, not wrong. Two locales and no library is a
   * stack this detector does not recognise. Neither is the "different
   * company" the disqualifier is for, so neither fires.
   */
  it('does not disqualify a team that is early rather than monolingual', () => {
    expect(
      scoreDesignPartnerFit({
        ...IDEAL,
        signalLabels: ['i18next'],
        localeCount: 1,
      }).disqualifiers,
    ).toEqual([]);
    expect(
      scoreDesignPartnerFit({ ...IDEAL, signalLabels: [], localeCount: 4 })
        .disqualifiers,
    ).toEqual([]);
  });

  it('reports both disqualifiers when both hold', () => {
    const fit = scoreDesignPartnerFit({
      ...IDEAL,
      signalLabels: [],
      localeCount: 0,
      tms: [{ vendor: 'Weblate', evidence: '.weblate', kind: 'config' }],
    });
    expect(fit.disqualifiers.map((d) => d.label).sort()).toEqual([
      'not_multilingual',
      'tms_in_use',
    ]);
  });

  it('qualifies the ideal repository', () => {
    const fit = scoreDesignPartnerFit(IDEAL);
    expect(fit.qualifies).toBe(true);
    expect(fit.disqualifiers).toEqual([]);
  });

  /* ---- Confidence ---- */

  it('is less confident about a score carried by inferred pain than by counting', () => {
    const counted = scoreDesignPartnerFit({
      ...IDEAL,
      painValue: 0,
      painConfidence: 0,
    });
    const inferred = scoreDesignPartnerFit({
      ...IDEAL,
      painValue: 100,
      painConfidence: 0.3,
    });
    expect(counted.confidence).toBe(1);
    expect(inferred.confidence).toBeLessThan(1);
  });

  it('reports zero confidence for a score of zero rather than dividing by it', () => {
    const fit = scoreDesignPartnerFit({
      signalLabels: [],
      localeCount: 0,
      distinctContributors: 0,
      contributorWindowDays: 90,
      commitsInWindow: 0,
      commitWindowDays: 90,
      painValue: 0,
      painConfidence: 0,
      tms: [],
      saasB2b: null,
    });
    expect(fit.value).toBe(0);
    expect(fit.confidence).toBe(0);
    expect(Number.isNaN(fit.confidence)).toBe(false);
  });

  /* ---- Weights ---- */

  it('honours custom weights, so a stored score stays readable', () => {
    const fit = scoreDesignPartnerFit(IDEAL, {
      ...DESIGN_PARTNER_WEIGHTS,
      libraryFit: 50,
      localeCount: 0,
    });
    expect(
      fit.breakdown.find((c) => c.component === 'library_fit')?.points,
    ).toBe(50);
    expect(fit.breakdown.find((c) => c.component === 'locale_count')?.max).toBe(
      0,
    );
  });
});
