import { describe, expect, it } from 'vitest';
import { type BriefInput, buildResearchBrief, renderBrief } from './brief.js';
import {
  type DesignPartnerInputs,
  scoreDesignPartnerFit,
} from './design-partner.js';

const FIT_INPUTS: DesignPartnerInputs = {
  signalLabels: ['i18next'],
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

function input(overrides: Partial<BriefInput> = {}): BriefInput {
  return {
    company: {
      name: 'Acme',
      domain: 'acme.example',
      repository: 'acme/app',
      discoveredUrl: 'https://github.com/acme/app',
    },
    fit: scoreDesignPartnerFit(FIT_INPUTS),
    signals: [
      {
        label: 'i18next',
        summary: 'Depends on i18next (i18next)',
        confidence: null,
        paths: [],
      },
    ],
    pain: [
      {
        label: 'deliberate_translation_work',
        summary: '4 commits describe translation work',
        severity: 'medium',
        confidence: 0.8,
      },
    ],
    evidence: [
      {
        label: 'i18next',
        summary: 'Depends on i18next',
        sourceUrl: 'https://github.com/acme/app/blob/main/package.json',
        observedAt: '2026-10-01',
      },
    ],
    locales: ['ar', 'de', 'en', 'es', 'fr', 'ja'],
    distinctContributors: 12,
    contributorWindowDays: 90,
    preparedAt: '2026-10-04',
    ...overrides,
  };
}

describe('buildResearchBrief', () => {
  it('separates what can be cited from what was only read', () => {
    const brief = buildResearchBrief(input());

    expect(brief.cited).toHaveLength(1);
    expect(brief.cited[0]?.sourceUrl).toContain('github.com');

    // The pain evidence has no URL and must not be promoted into `cited`,
    // where an operator would paste it as though a reader could follow it.
    expect(brief.uncited).toContain('4 commits describe translation work');
  });

  it('does not repeat an observation that already has a cited row', () => {
    // The i18next signal and the i18next evidence row are the same fact. It
    // belongs in one list.
    const brief = buildResearchBrief(input());
    expect(brief.uncited).not.toContain('Depends on i18next (i18next)');
  });

  it('keeps an evidence row with no URL, in the uncitable list', () => {
    const brief = buildResearchBrief(
      input({
        evidence: [
          {
            label: 'operator_note',
            summary: 'Mentioned i18n pain at a meetup',
            sourceUrl: null,
            observedAt: '2026-09-30',
          },
        ],
      }),
    );
    expect(brief.cited).toHaveLength(0);
    expect(brief.uncited).toContain('Mentioned i18n pain at a meetup');
  });

  /* ---- Verdict ---- */

  it('carries the disqualifiers through and marks the verdict', () => {
    const brief = buildResearchBrief(
      input({
        fit: scoreDesignPartnerFit({
          ...FIT_INPUTS,
          tms: [{ vendor: 'Crowdin', evidence: 'crowdin.yml', kind: 'config' }],
        }),
      }),
    );
    expect(brief.verdict).toBe('disqualified');
    expect(brief.disqualifiers.map((d) => d.label)).toEqual(['tms_in_use']);
    // The score survives a disqualification, and the brief shows it.
    expect(brief.score.value).toBeGreaterThan(0);
  });

  /* ---- Angle ---- */

  it('derives the angle from the strongest evidence present', () => {
    const brief = buildResearchBrief(input());
    expect(brief.angle?.kind).toBe('missing_translations');
    expect(brief.angle?.statement).toContain(
      '4 commits describe translation work',
    );
    expect(brief.angle?.restsOn).toEqual(['deliberate_translation_work']);
  });

  it('prefers a specific angle over a generic one', () => {
    // Both are available; the one that describes *them* wins over the one
    // that would describe anybody with six locales.
    const brief = buildResearchBrief(input());
    expect(brief.angle?.kind).not.toBe('many_locales');
  });

  it('falls back through the order as evidence disappears', () => {
    const manual = buildResearchBrief(
      input({
        pain: [
          {
            label: 'manual_translation_work',
            summary: '2 commits describe manual translation edits',
            severity: 'medium',
            confidence: 0.6,
          },
        ],
      }),
    );
    expect(manual.angle?.kind).toBe('manual_translation_work');

    const locales = buildResearchBrief(input({ pain: [] }));
    expect(locales.angle?.kind).toBe('many_locales');
  });

  /*
   * The property that stops this becoming a mail merge. With nothing to say,
   * it says nothing — rather than reaching for an opener that would be true
   * of any repository on GitHub.
   */
  it('has no angle when no evidence supports one', () => {
    const brief = buildResearchBrief(
      input({ pain: [], locales: ['en', 'fr'] }),
    );
    expect(brief.angle).toBeNull();
  });

  it('will not build the missing-translations angle for a single language', () => {
    // One language has no second catalogue to fall behind, so the strongest
    // angle does not apply however much translation work there is.
    const brief = buildResearchBrief(input({ locales: ['en'] }));
    expect(brief.angle?.kind).not.toBe('missing_translations');
  });

  /* ---- Not verified ---- */

  it('names every component the score could not assess', () => {
    const brief = buildResearchBrief(input());
    expect(brief.notVerified.join(' ')).toMatch(
      /cannot be read from a repository/i,
    );
  });

  it('names the contributor count as a proxy even when it was measured', () => {
    const brief = buildResearchBrief(input());
    expect(brief.notVerified.join(' ')).toMatch(/proxy/i);
    expect(brief.notVerified.join(' ')).toMatch(/nobody has counted/i);
  });

  it('says when nothing outside GitHub was read', () => {
    const brief = buildResearchBrief(
      input({
        company: {
          name: 'Acme',
          domain: null,
          repository: 'acme/app',
          discoveredUrl: null,
        },
      }),
    );
    expect(brief.notVerified.join(' ')).toMatch(/nothing outside GitHub/i);
  });

  /* ---- Open questions ---- */

  it('asks for the SaaS confirmation it refuses to infer', () => {
    const brief = buildResearchBrief(input());
    expect(brief.openQuestions.join(' ')).toMatch(/is this b2b saas/i);
    expect(brief.openQuestions.join(' ')).toMatch(/record the url/i);
  });

  it('refuses to let an uncitable brief go to outreach quietly', () => {
    const brief = buildResearchBrief(
      input({
        evidence: [
          {
            label: 'note',
            summary: 'heard about them',
            sourceUrl: null,
            observedAt: null,
          },
        ],
      }),
    );
    expect(brief.openQuestions.join(' ')).toMatch(
      /nothing here carries a URL/i,
    );
  });

  it('redirects a disqualified prospect away from a pitch', () => {
    const brief = buildResearchBrief(
      input({
        fit: scoreDesignPartnerFit({
          ...FIT_INPUTS,
          tms: [{ vendor: 'Phrase', evidence: 'phrase.yml', kind: 'config' }],
        }),
      }),
    );
    expect(brief.openQuestions.join(' ')).toMatch(/not a pitch/i);
  });

  it('asks nothing it could have answered itself', () => {
    const brief = buildResearchBrief(
      input({
        fit: scoreDesignPartnerFit({
          ...FIT_INPUTS,
          saasB2b: {
            sourceUrl: 'https://acme.example/pricing',
            note: 'per-seat, aimed at teams',
            confirmedAt: '2026-10-04',
          },
        }),
      }),
    );
    expect(brief.openQuestions).toEqual([]);
  });
});

describe('renderBrief', () => {
  it('puts what was not verified above the angle', () => {
    const markdown = renderBrief(buildResearchBrief(input()));
    expect(markdown.indexOf('## Not verified')).toBeLessThan(
      markdown.indexOf('## Angle'),
    );
    expect(markdown.indexOf('## Not verified')).toBeGreaterThan(-1);
  });

  it('renders every cited source as a followable line', () => {
    const markdown = renderBrief(buildResearchBrief(input()));
    expect(markdown).toContain(
      'https://github.com/acme/app/blob/main/package.json',
    );
    expect(markdown).toContain('(2026-10-01)');
  });

  it('says so plainly when there is nothing to cite', () => {
    const markdown = renderBrief(buildResearchBrief(input({ evidence: [] })));
    expect(markdown).toMatch(
      /None\. Nothing collected here carries a public URL\./,
    );
  });

  it('leads a disqualified brief with the refusal, not the score', () => {
    const markdown = renderBrief(
      buildResearchBrief(
        input({
          fit: scoreDesignPartnerFit({
            ...FIT_INPUTS,
            tms: [
              { vendor: 'Crowdin', evidence: 'crowdin.yml', kind: 'config' },
            ],
          }),
        }),
      ),
    );
    expect(markdown).toContain('**Not this ICP.**');
    expect(markdown).toContain('tms_in_use');
    expect(markdown).toContain('config: crowdin.yml');
  });

  it('says there is no angle rather than printing an empty heading', () => {
    const markdown = renderBrief(
      buildResearchBrief(input({ pain: [], locales: ['en', 'fr'] })),
    );
    expect(markdown).toMatch(/generic one is a template/i);
  });

  it('is deterministic and ends with a single newline', () => {
    const brief = buildResearchBrief(input());
    expect(renderBrief(brief)).toBe(renderBrief(brief));
    expect(renderBrief(brief).endsWith('\n')).toBe(true);
    expect(renderBrief(brief).endsWith('\n\n')).toBe(false);
  });

  it('names the company and the date it was prepared', () => {
    const markdown = renderBrief(buildResearchBrief(input()));
    expect(markdown.startsWith('# Acme\n')).toBe(true);
    expect(markdown).toContain('Prepared 2026-10-04');
    expect(markdown).toContain('acme.example · acme/app');
  });
});
