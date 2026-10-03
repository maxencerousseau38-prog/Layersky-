import 'server-only';
import { createAdminClient, readServiceRoleKey } from '@/lib/supabase/admin';

/**
 * Forget an installation GitHub says is gone.
 *
 * Called from the webhook on `installation.deleted`, which carries no session
 * and no user: the owner uninstalled on github.com and will never open a page
 * here to confirm it. The delivery's signature is the authentication, and
 * `forget_github_installation` is `service_role` only.
 *
 * It removes the link **and** revokes the private-repository entitlement, but
 * only the one connecting GitHub granted — a grant made by a human survives,
 * because its grounds were never the installation. That asymmetry lives in SQL
 * (`revoke_self_serve_private_repositories`) rather than here, so a second
 * caller cannot implement a more generous version of it.
 *
 * Returns rows removed: 0 means this deployment never knew the installation,
 * which is a different answer from "removed" and is reported as such.
 *
 * ## Why it fails closed-ish, and what that means
 *
 * A failure leaves the link in place, so the workspace keeps a capability
 * whose grounds are gone until somebody presses Verify. That is the behaviour
 * that existed before this function, so a failure is no worse than the status
 * quo — and the alternative, deleting optimistically before the RPC answers,
 * would disconnect a workspace on a transport blip. Logged either way.
 */
export async function forgetInstallation(
  installationId: number,
): Promise<number> {
  if (!readServiceRoleKey()) {
    console.error(
      'SUPABASE_SERVICE_ROLE_KEY is not set; an uninstalled GitHub App was not forgotten',
    );
    return 0;
  }

  try {
    const { data, error } = await createAdminClient().rpc(
      'forget_github_installation',
      { p_installation_id: installationId },
    );
    if (error) throw new Error(error.message);
    return typeof data === 'number' ? data : 0;
  } catch (error) {
    console.error(
      `could not forget GitHub installation ${installationId}:`,
      error,
    );
    return 0;
  }
}
