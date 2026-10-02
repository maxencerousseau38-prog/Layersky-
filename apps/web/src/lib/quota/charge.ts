import 'server-only';
import { createAdminClient, readServiceRoleKey } from '@/lib/supabase/admin';

/**
 * What a workspace may spend from this app.
 *
 * This said "from the browser" while the browser was the only caller. The
 * GitHub webhook is the second, since it gained a correction step that calls a
 * model; it resolves its workspace from the delivery's installation
 * (`lib/quota/installation.ts`) and then charges exactly the same way. Nothing
 * below changed to admit it — the function always took an organization, and
 * the webhook's problem was never this file, it was having no organization to
 * give it.
 *
 * ## Why this exists at all
 *
 * `apps/api` protects a personal CLI token and deliberately exempts the
 * operator token, on the stated grounds that it is "held by `apps/web`, which
 * has its own guards". `apps/web` had none. Every "Run pipeline" click reached
 * a paid model on the operator's account with no rate window and no daily
 * ceiling, which made the browser the cheapest way to spend somebody else's
 * money in this product.
 *
 * ## Why here and not in the API
 *
 * The API authenticates a *token*, not a workspace. The operator bearer carries
 * no organization, and `/v1/translate` has no field that would name one — so
 * charging there would mean changing the request contract for every caller,
 * including `@localize-infra/cli@0.1.0`, which is published and parses strictly.
 *
 * `apps/web` already knows the workspace, already holds the service-role key,
 * and is the only holder of the operator bearer. Enforcing here costs no
 * protocol change and cannot be bypassed by a customer, because the server
 * action re-reads the workspace under RLS before it charges anything.
 *
 * ## Why it charges the same counters
 *
 * `consume_api_quota` and `api_usage_daily` are reused exactly as they are. The
 * daily ceiling was always keyed by workspace; the browser was simply never
 * counted against it. One workspace now has one ceiling whichever way it
 * spends, which is what the number always claimed to mean.
 */

export type QuotaRoute = 'translate' | 'open_pr';

/** The row `consume_api_quota` returns, before interpretation. */
export interface QuotaRow {
  allowed: boolean;
  reason: string | null;
  retry_after_seconds: number | string | null;
  used: number | string | null;
  limit_value: number | string | null;
}

export type QuotaDecision =
  | { allowed: true }
  | {
      allowed: false;
      /** 'rate' — too fast; 'quota' — too much today. Different fixes. */
      reason: 'rate' | 'quota';
      retryAfterSeconds: number;
      used: number;
      limit: number;
    };

/**
 * Thrown when a run may not proceed.
 *
 * A class rather than a plain Error because the per-locale catch in
 * `run-actions.ts` must tell this apart from a locale that failed on its own: a
 * locale failure is isolated and the run carries on, while a refusal applies to
 * the whole workspace and every remaining locale would be refused too. Letting
 * it fall into the per-locale branch would turn one honest refusal into four
 * identical ones and report the run as `partial`.
 */
export class QuotaRefusal extends Error {
  readonly reason: 'rate' | 'quota' | 'unavailable';
  constructor(message: string, reason: 'rate' | 'quota' | 'unavailable') {
    super(message);
    this.name = 'QuotaRefusal';
    this.reason = reason;
  }
}

export function interpretQuotaRow(row: QuotaRow | undefined): QuotaDecision {
  if (!row) throw new Error('usage check returned no row');
  if (row.allowed) return { allowed: true };
  return {
    allowed: false,
    reason: row.reason === 'rate' ? 'rate' : 'quota',
    retryAfterSeconds: Math.max(1, Number(row.retry_after_seconds ?? 1)),
    used: Number(row.used ?? 0),
    limit: Number(row.limit_value ?? 0),
  };
}

/**
 * "in 45 seconds" / "in about 3 hours" — a wait somebody can act on.
 *
 * Deliberately a second copy of `apps/api`'s helper rather than a shared one.
 * `apps/web` does not depend on `apps/api` and must not start to; the only
 * package both could import is `packages/schemas`, which holds Zod contracts
 * and would be the wrong home for prose. Four lines of formatting is a smaller
 * cost than either of those, and **no number is duplicated** — every value in
 * the sentences below comes back from the database.
 */
export function describeDelay(seconds: number): string {
  if (seconds < 90) return `in ${Math.max(1, Math.round(seconds))} seconds`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `in about ${minutes} minutes`;
  return `in about ${Math.round(minutes / 60)} hours`;
}

/**
 * The refusal, in the terms of somebody who clicked a button.
 *
 * Close to the API's sentence but not the same one, and the difference is the
 * reader: the API is answering a CLI token holder in a terminal, this is
 * answering a member of a workspace looking at a run that stopped. Naming "this
 * CLI token" here would send them hunting for a token they never used.
 */
export function describeRefusal(
  route: QuotaRoute,
  decision: Extract<QuotaDecision, { allowed: false }>,
): string {
  const wait = describeDelay(decision.retryAfterSeconds);
  if (decision.reason === 'rate') {
    return route === 'translate'
      ? `This workspace is starting runs faster than the hosted API allows: the limit is ${decision.limit} translation requests a minute. Try again ${wait}.`
      : `This workspace is opening pull requests faster than the hosted API allows: the limit is ${decision.limit} a minute. Try again ${wait}.`;
  }
  return route === 'translate'
    ? `This workspace has reached today's translation ceiling of ${decision.limit} strings. It resets at 00:00 UTC, ${wait}. Nothing was translated and nothing was charged. Ask the operator if you need more.`
    : `This workspace has reached today's ceiling of ${decision.limit} pull requests. It resets at 00:00 UTC, ${wait}. Ask the operator if you need more.`;
}

/** Why a check that could not run refuses rather than waves the work through. */
export const UNAVAILABLE =
  'Could not check this workspace’s usage, so the run was stopped before spending anything. A check that failed is not evidence that there is budget left.';

export const NOT_CONFIGURED =
  'SUPABASE_SERVICE_ROLE_KEY is not set on this deployment, so this workspace’s usage cannot be checked and no run will spend on the hosted API.';

export interface ChargeInput {
  organizationId: string;
  route: QuotaRoute;
  /** The strings this request carries, or 1 for a pull request. */
  units: number;
  /** Injectable for tests; defaults to the service-role client. */
  rpc?: (args: Record<string, unknown>) => Promise<{
    data: unknown;
    error: { message: string } | null;
  }>;
}

/**
 * Charge the workspace, or throw `QuotaRefusal`.
 *
 * Fail-closed in every branch that is not an explicit allow — missing key,
 * transport fault, database error, absent row. The API takes the same position
 * for the same reason, and it is the only one that protects a budget: a check
 * that did not run tells you nothing about what is left.
 *
 * Called **before** the work, never after. After is too late: the money is
 * spent by then and a refusal protects nothing.
 */
export async function chargeWorkspace(input: ChargeInput): Promise<void> {
  const call =
    input.rpc ??
    (async (args: Record<string, unknown>) => {
      if (!readServiceRoleKey())
        throw new QuotaRefusal(NOT_CONFIGURED, 'unavailable');
      return await createAdminClient().rpc('consume_api_quota', args);
    });

  /*
   * Interpretation sits inside the guard, and that is not tidiness.
   *
   * It used to be outside, so a reply carrying no row escaped as a plain
   * `Error` instead of a `QuotaRefusal` — and the per-locale catch in
   * `run-actions.ts` would then have treated it as one language failing and
   * carried on to the next, which is the exact behaviour the class exists to
   * prevent. Found by the test asserting a fail-closed message, not by reading.
   */
  let decision: QuotaDecision;
  try {
    const { data, error } = await call({
      p_token_id: null,
      p_organization_id: input.organizationId,
      p_route: input.route,
      p_units: input.units,
    });
    if (error) throw new Error(error.message);
    const row = Array.isArray(data)
      ? (data[0] as QuotaRow | undefined)
      : (data as QuotaRow | undefined);
    decision = interpretQuotaRow(row);
  } catch (err) {
    if (err instanceof QuotaRefusal) throw err;
    // Logged whole, reported as one sentence: a PostgREST error can carry the
    // request it failed on, and this string reaches a customer's run detail.
    console.error('workspace usage check failed:', err);
    throw new QuotaRefusal(UNAVAILABLE, 'unavailable');
  }

  if (decision.allowed) return;
  throw new QuotaRefusal(
    describeRefusal(input.route, decision),
    decision.reason,
  );
}
