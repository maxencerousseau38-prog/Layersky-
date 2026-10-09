import 'server-only';
import { createAdminClient, readServiceRoleKey } from '@/lib/supabase/admin';
import {
  type ActivationMetrics,
  type ActivationStatus,
  deriveActivation,
} from '@localize-infra/closer-core';

/**
 * What the linked workspace has done, read with the service-role key.
 *
 * ## Why the key, and why that is not a shortcut
 *
 * A design-partner lead lives in the operator's organization; the prospect's
 * workspace is a different tenant, and every policy on its rows asks
 * `is_org_member(organization_id)` — which the operator is not. So there is no
 * session that can read these counters, and `closer_activation_metrics` is
 * `service_role` only by design: it takes the acting user as a parameter and
 * checks *that* user against the lead's workspace, which is the shape
 * `20260916000200` settled on after `link_github_installation` was found
 * trusting an id it was handed.
 *
 * `apps/web` establishing authority and then calling with the key is the
 * pattern already used by `record_i18n_check` and `consume_api_quota`. This is
 * the sixth caller, not the first — the claim in CLAUDE.md that
 * `lib/supabase/admin.ts` is "seul usage de cette clé" has been stale for
 * several milestones.
 *
 * ## It fails open, and that is the right direction here
 *
 * This is a read for display. `chargeWorkspace` fails closed because its
 * failure would spend money that nothing counted; nothing is spent here, and a
 * missing key should cost the operator a panel that says why rather than a
 * page that 500s. The distinction is named rather than silent: a missing key
 * and an unlinked lead are different facts, and reporting the first as the
 * second would tell the operator to go and link something that is already
 * linked.
 */

export interface ActivationView {
  status: ActivationStatus;
  /** Why no counters could be read, when that is the situation. */
  unavailable: string | null;
}

interface MetricsRow {
  activated_organization_id: string | null;
  installed_at: string | null;
  first_check_at: string | null;
  last_check_at: string | null;
  checks_total: number | string;
  distinct_check_days: number | string;
  distinct_pull_requests: number | string;
  repositories_checked: number | string;
  corrections_applied: number | string;
  has_paid_subscription: boolean | null;
}

/*
 * `bigint` arrives as a string.
 *
 * PostgREST renders Postgres `bigint` as JSON string, because the range does
 * not fit a double safely. Every counter in `closer_activation_metrics` is a
 * `count(*)`, so every one of them arrives as `"11"` rather than `11` — and
 * `deriveActivation` compares them against thresholds with `>=`, where
 * `"11" >= 2` happens to be true and `"11" >= 10` happens to be false. It
 * would have appeared to work.
 */
function count(value: number | string | null): number {
  if (value === null) return 0;
  const n = typeof value === 'string' ? Number.parseInt(value, 10) : value;
  return Number.isFinite(n) ? n : 0;
}

export async function loadActivation(
  leadId: string,
  userId: string,
): Promise<ActivationView> {
  if (readServiceRoleKey() === null) {
    return {
      status: deriveActivation(null),
      unavailable:
        'Activation cannot be read on this deployment: SUPABASE_SERVICE_ROLE_KEY is not set.',
    };
  }

  const { data, error } = await createAdminClient().rpc(
    'closer_activation_metrics',
    { p_lead_id: leadId, p_user_id: userId },
  );

  if (error) {
    return {
      status: deriveActivation(null),
      unavailable: `Activation could not be read: ${error.message}`,
    };
  }

  /*
   * No rows means no link. The function returns early rather than a row of
   * zeroes for exactly this reason — zero checks and "not matched to a
   * workspace yet" are different facts, and a row of zeroes reads as the
   * first.
   */
  const row = (data as MetricsRow[] | null)?.[0];
  if (!row) return { status: deriveActivation(null), unavailable: null };

  const metrics: ActivationMetrics = {
    activatedOrganizationId: row.activated_organization_id,
    installedAt: row.installed_at,
    firstCheckAt: row.first_check_at,
    lastCheckAt: row.last_check_at,
    checksTotal: count(row.checks_total),
    distinctCheckDays: count(row.distinct_check_days),
    distinctPullRequests: count(row.distinct_pull_requests),
    repositoriesChecked: count(row.repositories_checked),
    correctionsApplied: count(row.corrections_applied),
    hasPaidSubscription: row.has_paid_subscription === true,
  };

  return { status: deriveActivation(metrics), unavailable: null };
}
