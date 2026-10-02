import type { AuditReport } from '@localize-infra/eval';
import { describe, expect, it, vi } from 'vitest';
import {
  CHECK_NAME,
  buildCheckOutput,
  describeCorrection,
  publishCheck,
} from './checks';

const report = (over: Partial<AuditReport> = {}): AuditReport => ({
  findings: [],
  keysChecked: 3,
  localesChecked: ['de', 'fr'],
  dynamicCallSites: 0,
  unreferencedSourceKeys: 0,
  ...over,
});

describe('buildCheckOutput', () => {
  it('states what it checked on a pass, not just that it passed', () => {
    const output = buildCheckOutput(report());
    expect(output.title).toBe('No i18n problems found');
    expect(output.summary).toContain('3 keys');
    expect(output.summary).toContain('de, fr');
  });

  /*
   * Stated on a pass too. A green check that silently skipped the computed
   * keys is claiming more than it looked at, and the number is the denominator
   * a reader needs to judge what the green is worth.
   */
  it('admits the call sites it could not read, even when passing', () => {
    const output = buildCheckOutput(report({ dynamicCallSites: 2 }));
    expect(output.summary).toContain('2 call sites were skipped');
  });

  it('counts the findings by kind and lists them', () => {
    const output = buildCheckOutput(
      report({
        findings: [
          { kind: 'missing-translation', key: 'a', locale: 'fr', detail: 'x' },
          { kind: 'missing-translation', key: 'b', locale: 'fr', detail: 'y' },
          { kind: 'placeholder-mismatch', key: 'c', locale: 'de', detail: 'z' },
        ],
      }),
    );
    expect(output.title).toBe('3 i18n problems');
    expect(output.summary).toContain('2 missing-translation');
    expect(output.summary).toContain('1 placeholder-mismatch');
    expect(output.text).toContain('`fr`');
  });

  it('truncates a very long list and says how many are left', () => {
    const findings = Array.from({ length: 25 }, (_, i) => ({
      kind: 'missing-translation' as const,
      key: `k${i}`,
      locale: 'fr',
      detail: 'x',
    }));
    const output = buildCheckOutput(report({ findings }));
    expect(output.text).toContain('…and 5 more.');
  });

  /*
   * The line this product exists to hold. "No problems found" over a repository
   * nothing was read from is silence that reads as approval — the exact failure
   * being sold against, committed by the tool selling against it.
   */
  it('says why it could not analyse, instead of reporting a pass', () => {
    const output = buildCheckOutput(report(), 'No i18next catalogues found.');
    expect(output.title).toBe('Not analysed');
    expect(output.summary).toBe('No i18next catalogues found.');
    expect(output.title).not.toContain('No i18n problems');
  });
});

/*
 * The argument types are written out rather than inferred. `vi.fn(async () =>
 * …)` types its parameters as an empty tuple, so `mock.calls[0][0]` does not
 * compile — and the assertions below exist precisely to read what was sent.
 */
type Args = Record<string, unknown>;

function fakeChecks(existing: number[] = []) {
  return {
    listForRef: vi.fn(async (_args: Args) => ({
      data: { check_runs: existing.map((id) => ({ id })) },
    })),
    create: vi.fn(async (_args: Args) => ({ data: { id: 100 } })),
    update: vi.fn(async (_args: Args) => ({ data: { id: 200 } })),
  };
}

describe('publishCheck', () => {
  const base = { owner: 'acme', repo: 'shop', headSha: 'abc123' };

  it('creates a check when the commit has none', async () => {
    const checks = fakeChecks();
    const id = await publishCheck({ ...base, checks, report: report() });
    expect(id).toBe(100);
    expect(checks.create).toHaveBeenCalledOnce();
    expect(checks.update).not.toHaveBeenCalled();
  });

  /*
   * Idempotence, and the reason this slice needs no table: GitHub already keys
   * check runs by (name, head_sha). A second delivery for the same push must
   * update the run, not stack another one under the reviewer's eyes.
   */
  it('updates the existing check instead of stacking a second', async () => {
    const checks = fakeChecks([55]);
    const id = await publishCheck({ ...base, checks, report: report() });
    expect(id).toBe(200);
    expect(checks.update).toHaveBeenCalledOnce();
    expect(checks.create).not.toHaveBeenCalled();
    expect(checks.update.mock.calls[0]?.[0]).toMatchObject({
      check_run_id: 55,
    });
  });

  it('concludes success only for a clean audit that actually ran', async () => {
    const checks = fakeChecks();
    await publishCheck({ ...base, checks, report: report() });
    expect(checks.create.mock.calls[0]?.[0]).toMatchObject({
      conclusion: 'success',
      name: CHECK_NAME,
    });
  });

  it('concludes neutral when there are findings', async () => {
    const checks = fakeChecks();
    await publishCheck({
      ...base,
      checks,
      report: report({
        findings: [
          { kind: 'missing-translation', key: 'a', locale: 'fr', detail: 'x' },
        ],
      }),
    });
    expect(checks.create.mock.calls[0]?.[0]).toMatchObject({
      conclusion: 'neutral',
    });
  });

  /** A skip is not a pass and must not be coloured like one. */
  it('concludes neutral for a skip, never success', async () => {
    const checks = fakeChecks();
    await publishCheck({
      ...base,
      checks,
      report: report(),
      skipped: 'No i18next here.',
    });
    expect(checks.create.mock.calls[0]?.[0]).toMatchObject({
      conclusion: 'neutral',
    });
  });

  /*
   * A duplicate check is cosmetic; no check at all is the reviewer getting
   * silence and reading it as a pass. So a failed lookup creates.
   */
  it('creates anyway when the lookup fails', async () => {
    const checks = fakeChecks();
    checks.listForRef = vi.fn(async (_args: Args) => {
      throw new Error('403');
    });
    const id = await publishCheck({ ...base, checks, report: report() });
    expect(id).toBe(100);
    expect(checks.create).toHaveBeenCalledOnce();
  });
});

/**
 * The correction's own report, on the check.
 *
 * It used to go in the webhook's HTTP response. GitHub never read it: measured
 * against production on 2026-10-02, the delivery times out at ten seconds and
 * the log stores `context deadline exceeded` where the body should be. Every
 * delivery that corrected was recorded as a 500.
 *
 * So these pin the only surface a human actually reads — and in particular the
 * case that has no other one: a total refusal opens no pull request, so without
 * this section the reason exists nowhere at all.
 */
describe('describeCorrection', () => {
  const refusal = (locale: string) => ({
    locale,
    key: 'errors.timeout',
    reason: 'the model was not confident and asked: which register?',
  });

  it('reconciles the counts a reviewer reads first', () => {
    const text = describeCorrection({
      attempted: true,
      requested: 6,
      applied: 5,
      refusals: [refusal('de')],
      pr: { number: 16, url: 'https://github.com/o/r/pull/16' },
      reason: null,
    });

    expect(text).toContain('### Automatic correction');
    expect(text).toContain('**6 asked for');
    expect(text).toContain('5 added');
    expect(text).toContain('1 left for a person.**');
    expect(text).toContain('#16');
    expect(text).toContain('https://github.com/o/r/pull/16');
    expect(text).toContain('- **de** — `errors.timeout`: ');
    expect(text).toContain('which register?');
    // The arithmetic holds, so no complaint about ourselves.
    expect(text).not.toContain('defect in Layersky');
  });

  /*
   * The case this section exists for. Every unit refused means no pull request,
   * so the check is the only place the reason can appear — the run on
   * 2026-10-02 at 14:37 UTC had nowhere to put it and said nothing.
   */
  it('names the refusal when no pull request was opened at all', () => {
    const text = describeCorrection({
      attempted: true,
      requested: 1,
      applied: 0,
      refusals: [refusal('de')],
      pr: null,
      reason: 'No confident translation came back.',
    });

    expect(text).toContain('**1 asked for');
    expect(text).toContain('0 added');
    expect(text).toContain('1 left for a person.**');
    expect(text).toContain('No pull request was opened');
    expect(text).toContain('- **de** — `errors.timeout`: ');
  });

  it('says plainly when no correction was attempted', () => {
    const text = describeCorrection({
      attempted: false,
      reason: 'this installation is not connected to a Layersky workspace',
    });
    expect(text).toContain('Not attempted:');
    expect(text).toContain('not connected to a Layersky workspace');
    expect(text).not.toContain('asked for');
  });

  /*
   * The backstop made visible. `buildCorrection` guarantees the arithmetic, so
   * a day when it does not should be readable on the pull request rather than
   * only in a test — and the words must blame us, not the model.
   */
  it('complains about itself when the numbers do not add up', () => {
    const text = describeCorrection({
      attempted: true,
      requested: 6,
      applied: 4,
      refusals: [refusal('de')],
      pr: null,
      reason: null,
    });
    expect(text).toContain('do not add up');
    expect(text).toContain('defect in Layersky');
  });

  it('cuts a long refusal list rather than flooding the check', () => {
    const many = Array.from({ length: 25 }, (_, i) => refusal(`l${i}`));
    const text = describeCorrection({
      attempted: true,
      requested: 25,
      applied: 0,
      refusals: many,
      pr: null,
      reason: 'No confident translation came back.',
    });
    expect(text).toContain('…and 5 more.');
  });

  it('reports a correction that threw without claiming counts it does not have', () => {
    const text = describeCorrection({
      attempted: true,
      requested: 0,
      applied: 0,
      refusals: [],
      pr: null,
      reason: '502 Bad Gateway',
    });
    expect(text).toContain('Nothing was translated.');
    expect(text).toContain('502 Bad Gateway');
    expect(text).not.toContain('asked for');
  });
});

describe('buildCheckOutput, with a correction', () => {
  const correction = {
    attempted: true as const,
    requested: 6,
    applied: 5,
    refusals: [{ locale: 'de', key: 'errors.timeout', reason: 'not sure' }],
    pr: null,
    reason: 'No confident translation came back.',
  };

  /*
   * The verdict does not move. Title and conclusion describe *this* commit's
   * findings; the correction's effect only exists on the next one, and a check
   * that went green because a fix was proposed would be the false success this
   * product exists to remove.
   */
  it('leaves the title alone and appends the section', () => {
    const findings = [
      {
        kind: 'missing-translation' as const,
        key: 'errors.timeout',
        locale: 'de',
        detail: 'x',
      },
    ];
    const without = buildCheckOutput(report({ findings }));
    const with_ = buildCheckOutput(report({ findings }), null, correction);

    expect(with_.title).toBe(without.title);
    expect(with_.title).toBe('1 i18n problem');
    expect(with_.text).toBe(without.text);
    expect(with_.summary.startsWith(without.summary)).toBe(true);
    expect(with_.summary).toContain('### Automatic correction');
  });

  // Appended on every branch. "Except on that path" is how the last hole here
  // was shaped, so the skipped and clean branches carry it too.
  it.each([
    [
      'a skipped repository',
      () => buildCheckOutput(report(), 'no i18n library found', correction),
    ],
    ['a clean audit', () => buildCheckOutput(report(), null, correction)],
  ])('appends it to %s as well', (_label, build) => {
    expect(build().summary).toContain('### Automatic correction');
  });
});

describe('publishCheck, writing the correction onto the run it already made', () => {
  const api = (existing: number[] = []) => {
    const calls: { create: unknown[]; update: unknown[]; list: number } = {
      create: [],
      update: [],
      list: 0,
    };
    return {
      calls,
      checks: {
        listForRef: async () => {
          calls.list += 1;
          return { data: { check_runs: existing.map((id) => ({ id })) } };
        },
        create: async (args: Record<string, unknown>) => {
          calls.create.push(args);
          return { data: { id: 999 } };
        },
        update: async (args: Record<string, unknown>) => {
          calls.update.push(args);
          return { data: { id: args.check_run_id as number } };
        },
      },
    };
  };

  const base = {
    owner: 'o',
    repo: 'r',
    headSha: 'sha',
    report: report({
      findings: [
        { kind: 'missing-translation', key: 'k', locale: 'de', detail: 'x' },
      ],
    }),
  };

  /*
   * The id is passed, so no lookup happens — and that is not a saving. The
   * fallback for a failed lookup is to *create*, which on the second call of a
   * delivery would put a duplicate check on the commit instead of updating.
   */
  it('updates the known run without looking it up', async () => {
    const { calls, checks } = api();
    const id = await publishCheck({
      ...base,
      checks,
      checkRunId: 4242,
      correction: {
        attempted: true,
        requested: 1,
        applied: 0,
        refusals: [{ locale: 'de', key: 'k', reason: 'not sure' }],
        pr: null,
        reason: 'No confident translation came back.',
      },
    });

    expect(id).toBe(4242);
    expect(calls.list).toBe(0);
    expect(calls.create).toHaveLength(0);
    expect(calls.update).toHaveLength(1);

    const sent = calls.update[0] as {
      check_run_id: number;
      conclusion: string;
      output: { title: string; summary: string };
    };
    expect(sent.check_run_id).toBe(4242);
    // Still neutral, still the same verdict about this commit.
    expect(sent.conclusion).toBe('neutral');
    expect(sent.output.title).toBe('1 i18n problem');
    expect(sent.output.summary).toContain('### Automatic correction');
    expect(sent.output.summary).toContain('- **de** — `k`: not sure');
  });

  it('still looks up when no id is known, as the first call does', async () => {
    const { calls, checks } = api([77]);
    const id = await publishCheck({ ...base, checks });
    expect(id).toBe(77);
    expect(calls.list).toBe(1);
    expect(calls.update).toHaveLength(1);
  });
});
