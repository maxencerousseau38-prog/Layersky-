import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { REPORT } from './build.js';

/**
 * The narrative document, held to the model it quotes.
 *
 * `cost-model.test.ts` already stops a figure being edited into
 * `cost-model.json`: the committed artefact must equal what the generator
 * produces. It says nothing about `docs/product/09-unit-economics.md`, which
 * **transcribes** those figures into prose by hand — and that gap cost six
 * weeks of accuracy.
 *
 * On 2026-08-24, #40 and #41 moved `costPerThousandPairs` from 1.5492 to
 * 1.8342. Both updated the artefact. Neither updated the document, so its
 * headline number, its margin table, its plan table and its
 * "the model is 5% high" comparison were all wrong until 2026-10-10 — and the
 * document's own claim that "no figure in this document can be edited into
 * existence" was true of the JSON and false of the page it appeared on.
 *
 * ## Why a check rather than a generator
 *
 * Generating the prose was the alternative. It was rejected: the value of this
 * document is its argument — why the import allowance is separate from the
 * monthly one, why 2% is kept when 0.48% was measured, why the Vercel figure is
 * modelled at Pro. A generator would either template that prose, which makes
 * editing it a code change, or emit only the tables, which leaves every figure
 * quoted *in a sentence* unguarded. Those sentences are where the drift
 * actually happened.
 *
 * So the document stays hand-written and this test holds the numbers in it to
 * their source. The failure names the figure, the JSON path it came from and
 * the string the document should contain, so the fix is a find-and-replace
 * rather than an investigation.
 *
 * ## What this deliberately does not do
 *
 * It does not check every number on the page. It tracks the figures a reader
 * would act on — the per-pair cost, the four customer shapes, the plan
 * economics, the rate and the one production measurement. A comprehensive check
 * would need the document restructured into data, which is the generator this
 * rejected.
 *
 * It also makes no claim about what anything is *billed*. The production figure
 * is consumption at a published rate; `reconciledAgainstInvoice` is false and
 * the last assertion here keeps the document saying so.
 */

const here = dirname(fileURLToPath(import.meta.url));
const DOC = join(here, '../../../../docs/product/09-unit-economics.md');

const document = readFileSync(DOC, 'utf8');

/** `$1,234.56`, the way the document writes money over a thousand. */
const money = (n: number, places = 2) =>
  `$${n.toLocaleString('en-US', {
    minimumFractionDigits: places,
    maximumFractionDigits: places,
  })}`;

const customer = (name: string) => {
  const found = REPORT.customers.find((c) => c.name === name);
  if (!found) throw new Error(`the \`${name}\` scenario left the model`);
  return found;
};

const plan = (name: string) => {
  const found = REPORT.plans.find((p) => p.name === name);
  if (!found) throw new Error(`the \`${name}\` plan left the model`);
  return found;
};

/**
 * Every figure the document quotes that has a source in the model.
 *
 * `path` is only for the failure message — it is what somebody reads when the
 * test tells them the page and the artefact disagree.
 */
const TRACKED: { path: string; expected: string }[] = [
  // The unit everything reduces to.
  {
    path: 'unit.costPerThousandPairs',
    expected: money(REPORT.unit.costPerThousandPairs),
  },
  {
    path: 'unit.costPerThousandPairsAsConfiguredToday',
    expected: money(REPORT.unit.costPerThousandPairsAsConfiguredToday),
  },
  {
    path: 'unit.costPerThousandPairsHaiku',
    expected: money(REPORT.unit.costPerThousandPairsHaiku),
  },
  {
    path: 'unit.emptyRunCostPerLocale',
    expected: money(REPORT.unit.emptyRunCostPerLocale, 5),
  },

  // The four shapes, as the headline tables print them.
  {
    path: 'customers.normal.steadyStateMonthlyCost',
    expected: money(customer('normal').steadyStateMonthlyCost),
  },
  {
    path: 'customers.normal.firstMonthCost',
    expected: money(customer('normal').firstMonthCost),
  },
  {
    path: 'customers.normal.yearOneCost',
    expected: money(customer('normal').yearOneCost),
  },
  {
    path: 'customers.heavy.steadyStateMonthlyCost',
    expected: money(customer('heavy').steadyStateMonthlyCost),
  },
  {
    path: 'customers.heavy.firstMonthCost',
    expected: money(customer('heavy').firstMonthCost),
  },
  {
    path: 'customers.heavy.yearOneCost',
    expected: money(customer('heavy').yearOneCost),
  },
  {
    path: 'customers.worst-realistic.steadyStateMonthlyCost',
    expected: money(customer('worst-realistic').steadyStateMonthlyCost),
  },
  {
    path: 'customers.worst-realistic.firstMonthCost',
    expected: money(customer('worst-realistic').firstMonthCost),
  },
  {
    path: 'customers.worst-realistic.yearOneCost',
    expected: money(customer('worst-realistic').yearOneCost),
  },

  // The plan economics table.
  {
    path: 'plans.Free.worstMonthlyCogs',
    expected: money(plan('Free').worstMonthlyCogs),
  },
  {
    path: 'plans.Starter.worstMonthlyCogs',
    expected: money(plan('Starter').worstMonthlyCogs),
  },
  {
    path: 'plans.Team.worstMonthlyCogs',
    expected: money(plan('Team').worstMonthlyCogs),
  },
  {
    path: 'plans.Scale.worstMonthlyCogs',
    expected: money(plan('Scale').worstMonthlyCogs),
  },
  {
    path: 'plans.Starter.grossMarginPercentAtCap',
    expected: `${plan('Starter').grossMarginPercentAtCap}%`,
  },
  {
    path: 'plans.Team.grossMarginPercentAtCap',
    expected: `${plan('Team').grossMarginPercentAtCap}%`,
  },
  {
    path: 'plans.Scale.grossMarginPercentAtCap',
    expected: `${plan('Scale').grossMarginPercentAtCap}%`,
  },

  // The one production measurement, and the rate it is priced at.
  {
    path: 'productionObservation.derivedCostUsd',
    expected: money(REPORT.productionObservation.derivedCostUsd, 6),
  },
  {
    path: 'productionObservation.inputTokens',
    expected: REPORT.productionObservation.inputTokens.toLocaleString('en-US'),
  },
  {
    path: 'productionObservation.outputTokens',
    expected: String(REPORT.productionObservation.outputTokens),
  },
];

describe('09-unit-economics.md', () => {
  it.each(TRACKED)('quotes $path as $expected', ({ path, expected }) => {
    expect(
      document.includes(expected),
      `docs/product/09-unit-economics.md does not contain "${expected}", which is ${path} in cost-model.json. Re-run \`npm run cost:build -w @localize-infra/pricing\` and update the document to match.`,
    ).toBe(true);
  });

  /*
   * The rate, asserted on its own because it is written without a dollar sign
   * in the published-rates table ("| 2.00 | 10.00 |") and with one in prose.
   */
  it('quotes the standard rate the model is priced at', () => {
    const { input, output } = REPORT.rates.standard;
    expect(
      document,
      `the document does not state the input rate ${input}`,
    ).toContain(input.toFixed(2));
    expect(
      document,
      `the document does not state the output rate ${output}`,
    ).toContain(output.toFixed(2));
  });

  /*
   * The adversarial run, formatted with no decimals because that is how a
   * five-figure number reads in prose.
   */
  it('quotes the adversarial run cost', () => {
    const expected = `$${REPORT.adversarial.totalCost.toLocaleString('en-US')}`;
    expect(
      document.includes(expected),
      `the document does not contain "${expected}" (adversarial.totalCost)`,
    ).toBe(true);
  });

  /*
   * The honesty clause, and the reason this test exists at all rather than
   * only the figure checks.
   *
   * `reconciledAgainstInvoice` is false: every dollar figure above is measured
   * consumption multiplied by a published rate, and no provider invoice has
   * been compared to it. A document that quoted the figures correctly while
   * implying they were billed would be accurate and misleading at once, so the
   * disclosure is pinned both ways — the flag must stay false, and the page
   * must keep saying so.
   */
  it('never presents the measured cost as reconciled against an invoice', () => {
    expect(REPORT.productionObservation.reconciledAgainstInvoice).toBe(false);
    expect(
      document,
      'the document dropped the disclosure that no invoice has been compared',
    ).toMatch(/no provider invoice has been compared|not reconciled against/i);
    expect(
      document,
      'the document claims the cost is confirmed by a bill',
    ).not.toMatch(
      /reconciled against (an|the|our) (supplier )?invoices?\b(?![^.]*\bnot\b)/i,
    );
  });

  /*
   * One observation, six mixed locales. The model says so in a field; the
   * document has to say so in words, because a reader acting on $0.027264 needs
   * to know it is not a per-pair rate they can multiply.
   */
  it('keeps the single-observation caveat', () => {
    expect(REPORT.productionObservation.establishesCostPerPair).toBe(false);
    expect(
      document,
      'the document dropped the caveat that one observation is not a per-pair cost',
    ).toMatch(
      /does not establish a cost per pair|not a per-pair|one observation/i,
    );
  });
});
