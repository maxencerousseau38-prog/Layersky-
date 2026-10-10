import { describe, expect, it } from 'vitest';
import { recordModelUsage } from './usage';

const SOME = {
  requests: 2,
  inputTokens: 600,
  outputTokens: 240,
  thinkingTokens: 80,
};

describe('recordModelUsage', () => {
  it('writes what the calls consumed, against the workspace', async () => {
    const calls: Record<string, unknown>[] = [];
    await recordModelUsage({
      organizationId: 'org-1',
      operation: 'correction',
      usage: SOME,
      rpc: async (args) => {
        calls.push(args);
        return { error: null };
      },
    });

    expect(calls).toEqual([
      {
        p_organization_id: 'org-1',
        p_operation: 'correction',
        p_requests: 2,
        p_input_tokens: 600,
        p_output_tokens: 240,
        p_thinking_tokens: 80,
      },
    ]);
  });

  /*
   * A delivery that corrects nothing is the common case — a
   * `placeholder-mismatch` is always left for a person and GitHub redelivers
   * on every push — so a refusal must cost nothing, including no round trip.
   */
  it('writes nothing when no model was reached', async () => {
    let called = 0;
    await recordModelUsage({
      organizationId: 'org-1',
      operation: 'correction',
      usage: {
        requests: 0,
        inputTokens: 0,
        outputTokens: 0,
        thinkingTokens: 0,
      },
      rpc: async () => {
        called += 1;
        return { error: null };
      },
    });
    expect(called).toBe(0);
  });

  /*
   * The opposite stance to `chargeWorkspace`, deliberately. That one fails
   * closed because a check that did not run is no evidence of budget; here the
   * money is already spent, and a correction that worked must not be reported
   * as failed because a bookkeeping row would not insert.
   */
  it('does not throw when the write fails', async () => {
    await expect(
      recordModelUsage({
        organizationId: 'org-1',
        operation: 'correction',
        usage: SOME,
        rpc: async () => ({ error: { message: 'permission denied' } }),
      }),
    ).resolves.toBeUndefined();
  });

  /*
   * The browser run path, added once `recordModelUsage` had exactly one caller
   * and the audit found two spend paths unmeasured. Only one of the two turned
   * out to reach a model: `ambiguity-actions.ts` charges `open_pr` and calls
   * `/v1/open-pr`, never `/v1/translate`, so it has no tokens to record and
   * instrumenting it would have invented consumption.
   *
   * `'run'` was already in `UsageOperation` before any caller passed it. What
   * constrains it is the TypeScript union and nothing else: `p_operation` is
   * `text` in SQL, appears only in the signature, and is deliberately neither
   * stored nor checked — `i18n_checks` already records what caused a
   * correction's spend, and a second breakdown here would be the parallel
   * account that function reuses one row to avoid. So this asserts the value
   * travels verbatim rather than that anything downstream validates it.
   */
  it('records a browser run under the run operation', async () => {
    const calls: Record<string, unknown>[] = [];
    await recordModelUsage({
      organizationId: 'org-1',
      operation: 'run',
      usage: SOME,
      rpc: async (args) => {
        calls.push(args);
        return { error: null };
      },
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      p_organization_id: 'org-1',
      p_operation: 'run',
      p_requests: 2,
      p_input_tokens: 600,
      p_output_tokens: 240,
      p_thinking_tokens: 80,
    });
  });

  /*
   * The shape of the run loop, which is where double counting would come from.
   *
   * `run-actions.ts` calls `/v1/translate` once per target locale, inside the
   * `toTranslate.length > 0` guard, and records after each. So a two-locale run
   * makes two calls carrying their own tallies — not one call carrying a total,
   * and not the same tally twice. `record_model_usage` sums them into the single
   * `(organization_id, usage_date)` row, which `supabase/tests/model-usage.sql`
   * proves as `summed-requests`; what this asserts is the half above SQL, that
   * each call is handed over once with its own numbers.
   */
  it('records each locale call once, with its own tally', async () => {
    const calls: Record<string, unknown>[] = [];
    const rpc = async (args: Record<string, unknown>) => {
      calls.push(args);
      return { error: null };
    };

    await recordModelUsage({
      organizationId: 'org-1',
      operation: 'run',
      usage: {
        requests: 1,
        inputTokens: 1600,
        outputTokens: 40,
        thinkingTokens: 0,
      },
      rpc,
    });
    await recordModelUsage({
      organizationId: 'org-1',
      operation: 'run',
      usage: {
        requests: 1,
        inputTokens: 1800,
        outputTokens: 180,
        thinkingTokens: 0,
      },
      rpc,
    });

    expect(calls).toHaveLength(2);
    expect(calls.map((c) => c.p_input_tokens)).toEqual([1600, 1800]);
    expect(calls.map((c) => c.p_requests)).toEqual([1, 1]);
    // Neither call carries the other's total, which is what a hoisted
    // accumulator would have produced.
    expect(calls.map((c) => c.p_output_tokens)).toEqual([40, 180]);
  });

  it('does not throw when the client itself is unavailable', async () => {
    await expect(
      recordModelUsage({
        organizationId: 'org-1',
        operation: 'correction',
        usage: SOME,
        rpc: async () => {
          throw new Error('fetch failed');
        },
      }),
    ).resolves.toBeUndefined();
  });
});
