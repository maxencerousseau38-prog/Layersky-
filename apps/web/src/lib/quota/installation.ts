import 'server-only';
import { createAdminClient, readServiceRoleKey } from '@/lib/supabase/admin';

/**
 * Which workspace a GitHub delivery spends on.
 *
 * ## The gap this closes
 *
 * `chargeWorkspace` needs an organization. A webhook authenticates an
 * *installation* — GitHub holds no session and names no workspace — so the
 * correction path had nothing to charge and charged nothing. Every delivery
 * that found a missing translation reached a paid model on the operator's
 * account with no rate window and no daily ceiling, bounded only by
 * `MAX_CORRECTION_UNITS` per delivery and by nothing at all per day.
 *
 * That is the same shape as the defect `apps/api/src/quota.ts` described and
 * `apps/web` then reproduced: a sentence explaining why a guard was unnecessary,
 * standing where the guard should have been. The browser was fixed in #104 by
 * giving the charge a workspace. This gives the webhook one.
 *
 * ## Why the row already there is enough
 *
 * `organization_github_installations` is keyed by organization and its
 * `installation_id` is `unique` — "one installation belongs to exactly one
 * account, and letting two workspaces claim the same one would let either act
 * as the other", as that migration puts it. So the delivery's own
 * `installation.id` resolves to at most one workspace, and the uniqueness
 * constraint is what makes that a fact rather than a first match.
 *
 * No migration, no function and no new column: the mapping this needs has
 * existed since `20260817000600`. Nothing was ever asking it this question.
 *
 * ## Why the service-role key and not a session
 *
 * There is no session to use. The table's only policy is
 * `org_github_installations_select_member`, which needs an authenticated member,
 * and the one thing on the other end of this request is GitHub. The read is
 * a single row by a unique key, and it is a read — the service-role surface in
 * this app stays what it was plus one `select`.
 *
 * A definer function granted to `service_role` would have been the other
 * option. It would add an object to the schema to wrap a query that needs no
 * guard beyond the one the unique index already gives, and `get_advisors`
 * has already caught this repository leaving `anon` execute on a new function
 * once.
 */

/** Resolved, or refused with the sentence saying why. */
export type InstallationWorkspace =
  | { organizationId: string; reason: null }
  | { organizationId: null; reason: string };

/** The shape of the one query this makes, so a test can stand in for it. */
export type InstallationReader = (installationId: number) => Promise<{
  data: { organization_id?: unknown } | null;
  error: { message: string } | null;
}>;

export const NOT_CONNECTED =
  'This installation is not connected to a Layersky workspace, so there is no workspace to charge and nothing was translated. Connect the repository from the dashboard first.';

export const NOT_CONFIGURED =
  'SUPABASE_SERVICE_ROLE_KEY is not set on this deployment, so the workspace behind this installation cannot be read and nothing will be translated.';

export const UNAVAILABLE =
  'Could not read which workspace this installation belongs to, so nothing was translated. A lookup that failed is not evidence that there is budget to spend.';

/**
 * Resolve the delivery's installation to the workspace that pays for it.
 *
 * Fails closed in all three ways it can fail — key absent, read failed, no row
 * — and the caller treats every one of them as "do not translate". That is the
 * position `chargeWorkspace` already takes, for the reason it already gives: a
 * check that did not run tells you nothing about what is left.
 *
 * The distinct sentences are the point. "Not connected" is something the reader
 * can fix in the dashboard in a minute; the other two are operator problems and
 * naming the variable is what tells them apart — this repository has already
 * lost time to `vercel env add` recording empty values that `vercel env ls`
 * lists as present.
 */
export async function resolveInstallationWorkspace(
  installationId: number,
  read?: InstallationReader,
): Promise<InstallationWorkspace> {
  const query: InstallationReader =
    read ??
    (async (id) =>
      await createAdminClient()
        .from('organization_github_installations')
        .select('organization_id')
        .eq('installation_id', id)
        .maybeSingle());

  if (!read && !readServiceRoleKey()) {
    return { organizationId: null, reason: NOT_CONFIGURED };
  }

  try {
    const { data, error } = await query(installationId);
    if (error) throw new Error(error.message);

    const organizationId = data?.organization_id;
    if (typeof organizationId !== 'string' || organizationId.length === 0) {
      return { organizationId: null, reason: NOT_CONNECTED };
    }
    return { organizationId, reason: null };
  } catch (err) {
    // Logged whole, reported as one sentence: a PostgREST error can carry the
    // request it failed on, and this string is returned in the webhook's body.
    console.error('installation → workspace lookup failed:', err);
    return { organizationId: null, reason: UNAVAILABLE };
  }
}
