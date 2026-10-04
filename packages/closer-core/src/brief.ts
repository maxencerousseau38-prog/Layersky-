import type { DesignPartnerFit, Disqualifier } from './design-partner.js';
import type { PainEvidence } from './pain.js';
import type { DetectedSignal } from './signals.js';

/**
 * The one page an operator reads before deciding whether to contact somebody.
 *
 * ## Why a brief rather than a score
 *
 * `scoreDesignPartnerFit` answers "how well does this fit", which is the
 * question for ranking a list. Before writing to a person the question is
 * different: *what do I actually know, how do I know it, and what am I about
 * to assume?* A number cannot answer that, and a number presented as if it
 * could is how outreach ends up citing something nobody checked.
 *
 * ## Three properties, and the third is the one that matters
 *
 * **Every claim carries its source.** A line with no URL is not evidence, it
 * is a recollection. `closer_evidence.source_url` is already required for the
 * same reason; this keeps that property when the rows become prose.
 *
 * **The angle is derived, not invented.** It is chosen from the strongest
 * evidence present and is null when there is none — rather than falling back
 * to a generic opener, which is a template, and a template is the thing this
 * whole subsystem exists to avoid producing.
 *
 * **What was not verified is a section, not an omission.** A brief that lists
 * six findings and silently skips the three nobody looked at reads as a
 * complete picture. This project has already published a score out of
 * seventy as if it were out of a hundred; the fix there was to list the
 * unmeasured components at zero, and this is the same fix in prose.
 *
 * No model is called. Everything here is a rearrangement of facts the
 * research step already collected, which is why it is a pure function and
 * why it can be tested without a network.
 */

export interface BriefCompany {
  name: string;
  domain: string | null;
  repository: string | null;
  /** Where the company was found, so discovery can be re-opened. */
  discoveredUrl: string | null;
}

export interface BriefEvidence {
  label: string;
  summary: string;
  /** Required by the same rule `closer_evidence` enforces. */
  sourceUrl: string | null;
  observedAt: string | null;
}

export interface BriefInput {
  company: BriefCompany;
  fit: DesignPartnerFit;
  signals: readonly DetectedSignal[];
  pain: readonly PainEvidence[];
  /** Rows from `closer_evidence`, which carry the URLs the rest do not. */
  evidence: readonly BriefEvidence[];
  locales: readonly string[];
  /** Null when the contributor list was not collected. */
  distinctContributors: number | null;
  contributorWindowDays: number;
  /** Today, injectable so the rendered brief is reproducible in a test. */
  preparedAt: string;
}

export type AngleKind =
  | 'missing_translations'
  | 'stale_translations'
  | 'manual_translation_work'
  | 'many_locales';

export interface BriefAngle {
  kind: AngleKind;
  /** One sentence an operator could say out loud, grounded in the evidence. */
  statement: string;
  /** The evidence labels this rests on. */
  restsOn: string[];
}

export interface ResearchBrief {
  company: BriefCompany;
  preparedAt: string;
  /** `qualified`, or the reason it is not. */
  verdict: 'qualified' | 'disqualified';
  disqualifiers: readonly Disqualifier[];
  score: { value: number; assessable: number; confidence: number };
  /** Facts with a source, ready to be cited. */
  cited: BriefEvidence[];
  /** Facts collected without a URL. Usable, not citable. */
  uncited: string[];
  angle: BriefAngle | null;
  /** Named gaps: what nobody looked at, and what cannot be looked at. */
  notVerified: string[];
  /** What the operator has to find out before writing. */
  openQuestions: string[];
}

/*
 * The angles, strongest first.
 *
 * Ordered by how specific the resulting sentence is rather than by how severe
 * the evidence is. "Six languages and a key added last week" is a sentence
 * about them; "you have a lot of locales" is a sentence about anybody.
 */
const ANGLE_ORDER: AngleKind[] = [
  'missing_translations',
  'manual_translation_work',
  'stale_translations',
  'many_locales',
];

function buildAngle(input: BriefInput): BriefAngle | null {
  const byLabel = new Map(input.pain.map((p) => [p.label, p]));
  const locales = input.locales.length;

  const candidates: Partial<Record<AngleKind, BriefAngle>> = {};

  /*
   * The product's own case, and the only angle that describes what Layersky
   * would have caught. It needs deliberate translation work *and* more than
   * one language — a repository translating into one language has no second
   * catalogue to fall behind.
   */
  const deliberate = byLabel.get('deliberate_translation_work');
  if (deliberate && locales >= 2) {
    candidates.missing_translations = {
      kind: 'missing_translations',
      statement: `${deliberate.summary}, across ${locales} languages — every one of those is a pull request where a forgotten key ships silently.`,
      restsOn: [deliberate.label],
    };
  }

  const manual = byLabel.get('manual_translation_work');
  if (manual) {
    candidates.manual_translation_work = {
      kind: 'manual_translation_work',
      statement: `${manual.summary} — that is the work the check removes, not the work it adds.`,
      restsOn: [manual.label],
    };
  }

  const stale = byLabel.get('stale_translations');
  if (stale) {
    candidates.stale_translations = {
      kind: 'stale_translations',
      statement: `${stale.summary}. Nothing told anybody, because nothing was watching.`,
      restsOn: [stale.label],
    };
  }

  /*
   * The weakest, and kept because it is still true and still specific to a
   * number. Below six languages it says nothing a reader does not know about
   * their own product, so it does not fire.
   */
  if (locales >= 6) {
    candidates.many_locales = {
      kind: 'many_locales',
      statement: `${locales} languages in the repository (${input.locales.slice(0, 6).join(', ')}${locales > 6 ? ', …' : ''}) — one missed key is ${locales - 1} broken screens.`,
      restsOn: ['locale_count'],
    };
  }

  for (const kind of ANGLE_ORDER) {
    const angle = candidates[kind];
    if (angle) return angle;
  }
  return null;
}

export function buildResearchBrief(input: BriefInput): ResearchBrief {
  const cited = input.evidence.filter((e) => e.sourceUrl !== null);

  /*
   * Facts without a URL, kept and separated rather than dropped.
   *
   * Signals and pain come from reading a repository through the API; they are
   * real and they are not links. Mixing them into `cited` would let an
   * operator paste one into an email as though a reader could follow it.
   */
  const uncited = [
    ...input.evidence.filter((e) => e.sourceUrl === null).map((e) => e.summary),
    ...input.signals
      .filter((s) => !input.evidence.some((e) => e.label === s.label))
      .map((s) => s.summary),
    ...input.pain
      .filter((p) => !input.evidence.some((e) => e.label === p.label))
      .map((p) => p.summary),
  ];

  /*
   * The gaps, from two different causes, named the same way.
   *
   * `notAssessed` is what the score could not measure. The contributor count
   * gets its own line even when it *was* measured, because it is a proxy and
   * a brief that prints it without that word invites somebody to read it as a
   * headcount.
   */
  const notVerified: string[] = [];
  for (const component of input.fit.notAssessed) {
    const why = input.fit.breakdown.find((c) => c.component === component)?.why;
    notVerified.push(why ?? `${component}: not assessed`);
  }
  if (input.distinctContributors !== null) {
    notVerified.push(
      `Team size is a proxy: ${input.distinctContributors} distinct contributors, ${input.contributorWindowDays}d. Nobody has counted the company's developers.`,
    );
  }
  if (input.company.domain === null) {
    notVerified.push(
      'No company domain resolved from the repository, so nothing outside GitHub was read.',
    );
  }

  /*
   * Questions, and every one of them is something a person has to go and
   * find out. A question the research could have answered belongs in the
   * research, not here.
   */
  const openQuestions: string[] = [];
  if (input.fit.notAssessed.includes('saas_b2b')) {
    openQuestions.push(
      'Is this B2B SaaS? Confirm from a pricing or customers page and record the URL.',
    );
  }
  if (input.fit.notAssessed.includes('team_size_proxy')) {
    openQuestions.push(
      'How many people commit to this repository? The contributor list was not collected.',
    );
  }
  if (cited.length === 0) {
    openQuestions.push(
      'Nothing here carries a URL. Find at least one public page before writing, or there is nothing to cite.',
    );
  }
  if (input.fit.disqualifiers.length > 0) {
    openQuestions.push(
      'This is disqualified. The useful conversation is why they chose what they chose, not a pitch.',
    );
  }

  return {
    company: input.company,
    preparedAt: input.preparedAt,
    verdict: input.fit.qualifies ? 'qualified' : 'disqualified',
    disqualifiers: input.fit.disqualifiers,
    score: {
      value: input.fit.value,
      assessable: input.fit.assessable,
      confidence: input.fit.confidence,
    },
    cited,
    uncited,
    angle: buildAngle(input),
    notVerified,
    openQuestions,
  };
}

/* ------------------------------------------------------------------ *
 * Rendering
 * ------------------------------------------------------------------ */

/**
 * Markdown, because the operator pastes this somewhere.
 *
 * Section order is the order a decision gets made in: is this a fit, what do
 * I know, what would I say, and what am I about to assume. "Not verified"
 * sits **above** the angle deliberately — reading the pitch first and the
 * caveats afterwards is how a caveat gets skipped.
 */
export function renderBrief(brief: ResearchBrief): string {
  const lines: string[] = [];
  const { company } = brief;

  lines.push(`# ${company.name}`);
  const identity = [
    company.domain,
    company.repository,
    company.discoveredUrl ? `found at ${company.discoveredUrl}` : null,
  ].filter((part): part is string => part !== null);
  if (identity.length > 0) lines.push(identity.join(' · '));
  lines.push(`Prepared ${brief.preparedAt}`);
  lines.push('');

  lines.push('## Verdict');
  if (brief.verdict === 'disqualified') {
    lines.push(
      `**Not this ICP.** Score ${brief.score.value}/${brief.score.assessable} assessable, kept so the decision can be revisited if this changes.`,
    );
    for (const disqualifier of brief.disqualifiers) {
      lines.push('');
      lines.push(`- **${disqualifier.label}** — ${disqualifier.summary}`);
      for (const item of disqualifier.evidence) lines.push(`  - ${item}`);
    }
  } else {
    lines.push(
      `Fit **${brief.score.value}/${brief.score.assessable}** assessable, confidence ${brief.score.confidence}.`,
    );
  }
  lines.push('');

  lines.push('## Evidence a reader can follow');
  if (brief.cited.length === 0) {
    lines.push('None. Nothing collected here carries a public URL.');
  } else {
    for (const item of brief.cited) {
      const when = item.observedAt ? ` (${item.observedAt})` : '';
      lines.push(`- ${item.summary}${when} — ${item.sourceUrl}`);
    }
  }
  lines.push('');

  if (brief.uncited.length > 0) {
    lines.push('## Read from the repository, with no page to link');
    for (const item of brief.uncited) lines.push(`- ${item}`);
    lines.push('');
  }

  lines.push('## Not verified');
  if (brief.notVerified.length === 0) {
    lines.push('Nothing outstanding.');
  } else {
    for (const item of brief.notVerified) lines.push(`- ${item}`);
  }
  lines.push('');

  lines.push('## Angle');
  lines.push(
    brief.angle
      ? `${brief.angle.statement}\n\nRests on: ${brief.angle.restsOn.join(', ')}.`
      : 'None. No evidence here supports a specific opening, and a generic one is a template.',
  );
  lines.push('');

  if (brief.openQuestions.length > 0) {
    lines.push('## Before writing');
    for (const question of brief.openQuestions) lines.push(`- ${question}`);
    lines.push('');
  }

  return `${lines.join('\n').trimEnd()}\n`;
}
