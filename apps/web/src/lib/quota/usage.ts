import 'server-only';
import type { ModelUsage } from '@/lib/i18n/correct-run';
import { createAdminClient, readServiceRoleKey } from '@/lib/supabase/admin';

/**
 * What a workspace's model calls consumed, written where its usage already
 * lives.
 *
 * ## Why this is not `chargeWorkspace`
 *
 * They happen at different moments and mean different things.
 * `chargeWorkspace` runs **before** the work, against a count the caller
 * declares, and may refuse. This runs **after**, from what the provider
 * reported, and may not. Folding them together would mean either charging a
 * quota for tokens nobody has spent yet, or learning the cost too late to
 * refuse — and the ceiling has to be enforceable before the money is gone.
 *
 * ## Why it never throws
 *
 * `chargeWorkspace` fails closed because a check that did not run is no
 * evidence of budget. The opposite holds here: the money is already spent, and
 * failing to write it down helps nobody. A correction that worked must not be
 * reported as failed because a bookkeeping row would not insert. Logged and
 * swallowed, which is the same position `recordCheck` takes.
 *
 * ## Tokens, not money
 *
 * No rate is applied. Vendor prices change and differ per model, and a dollar
 * figure frozen into a row is wrong the day the rate moves with nothing to say
 * which rate produced it. `docs/product/09-unit-economics.md` holds the rate;
 * this holds what was consumed.
 */
export type UsageOperation = 'correction' | 'run';

export interface RecordUsageInput {
  organizationId: string;
  /**
   * What was being done. Accepted and deliberately not stored: `i18n_checks`
   * already records the correction that caused the spend, and a second
   * breakdown here would be the parallel account this reuses one row to avoid.
   * It is in the signature so a caller must say, and so the day a breakdown is
   * genuinely needed every call site already carries it.
   */
  operation: UsageOperation;
  usage: ModelUsage;
  /** Injectable for tests; defaults to the service-role client. */
  rpc?: (args: Record<string, unknown>) => Promise<{
    error: { message: string } | null;
  }>;
}

export async function recordModelUsage(input: RecordUsageInput): Promise<void> {
  /*
   * Nothing reached a provider, so there is nothing to record. The guard is
   * here as well as in SQL because the common delivery plans no correction at
   * all, and a round trip per webhook to add zero is a cost of its own.
   */
  if (input.usage.requests <= 0) return;

  try {
    const call =
      input.rpc ??
      (async (args: Record<string, unknown>) => {
        if (!readServiceRoleKey()) {
          throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set');
        }
        return await createAdminClient().rpc('record_model_usage', args);
      });

    const { error } = await call({
      p_organization_id: input.organizationId,
      p_operation: input.operation,
      p_requests: input.usage.requests,
      p_input_tokens: input.usage.inputTokens,
      p_output_tokens: input.usage.outputTokens,
      p_thinking_tokens: input.usage.thinkingTokens,
    });
    if (error) throw new Error(error.message);
  } catch (err) {
    // Logged whole, reported nowhere: a PostgREST error can carry the request
    // it failed on, and no reader of a pull request needs it.
    console.error('recording model usage failed:', err);
  }
}
