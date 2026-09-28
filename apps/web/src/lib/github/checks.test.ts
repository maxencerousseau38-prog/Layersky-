import type { AuditReport } from '@localize-infra/eval';
import { describe, expect, it, vi } from 'vitest';
import { CHECK_NAME, buildCheckOutput, publishCheck } from './checks';

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
