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
