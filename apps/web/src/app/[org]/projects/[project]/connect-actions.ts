'use server';

import {
  findOrganization,
  findProject,
  mayUsePrivateRepositories,
  requireSession,
} from '@/lib/data/workspace';
import {
  canReachRepository,
  installationIdFor,
} from '@/lib/github/repositories';
import { createClient } from '@/lib/supabase/server';
import { InvalidRootDir, normaliseRootDir } from '@localize-infra/core';
import { revalidatePath } from 'next/cache';

export interface ConnectState {
  error?: string;
}

/**
 * Points a project at a repository, and optionally at a subdirectory inside it.
 *
 * Three checks, in this order, all server-side:
 *  1. the caller can see the project — RLS does this, via findProject;
 *  2. the workspace's own installation can actually reach the repository — so
 *     a crafted post cannot record a pointer to something never granted;
 *  3. private repositories need the paid capability.
 *
 * This list used to open with "the caller is an operator — the installation is
 * shared", describing a gate the body of this function has not had since
 * `isOperator` was deleted for having no callers. The authorization is the
 * installation itself now, and step 2 is where it happens.
 *
 * The form only ever offers reachable repositories, but a form is a
 * convenience and not a control.
 */
export async function connectRepository(
  orgSlug: string,
  projectSlug: string,
  _prev: ConnectState,
  formData: FormData,
): Promise<ConnectState> {
  await requireSession();

  /*
   * No operator allow-list here any more.
   *
   * That gate existed for one reason: the installation was shared, so a token
   * issued for any workspace reached every repository the deployment had ever
   * been granted. `installationIdFor` no longer falls back to it, so a
   * workspace reaches its own repositories or none — the authorization is now
   * the installation itself rather than a list of addresses, and
   * `canReachRepository` below is where it is enforced.
   */

  const selection = String(formData.get('repository') ?? '').trim();
  const [owner, name] = selection.split('/');
  if (!owner || !name) return { error: 'Choose a repository.' };

  /*
   * The subdirectory, normalised before anything else looks at it.
   *
   * A monorepo is the common shape and the pipeline could not address one: it
   * ran `detectFramework` at the root of the checkout, found nothing, and said
   * "No supported framework detected" — true, unhelpful, and with no way out.
   *
   * `normaliseRootDir` throws rather than returning a flag because every
   * refusal has a different sentence to say, and the person typing the value is
   * the person who needs to read it. Empty is not an error: it means the
   * repository root, which is where most projects live.
   */
  let rootDir: string | null;
  try {
    rootDir = normaliseRootDir(String(formData.get('rootDir') ?? ''));
  } catch (error) {
    if (error instanceof InvalidRootDir) return { error: error.message };
    throw error;
  }

  const organization = await findOrganization(orgSlug);
  if (!organization) return { error: 'That workspace is not available.' };

  const project = await findProject(organization.id, projectSlug);
  if (!project) return { error: 'That project is not available.' };

  const installation = await installationIdFor(organization.id);
  if (!installation) {
    return {
      error:
        'This workspace has not installed the Localize GitHub App yet. Install it, choose which repositories it may see, and come back.',
    };
  }

  const repository = await canReachRepository({
    owner,
    name,
    organizationId: organization.id,
  });
  if (!repository) {
    // Reachable rather than merely named: the installation exists but was not
    // granted this repository, which is a different problem from having no
    // installation and needs a different sentence.
    return {
      error: `Your installation cannot reach ${owner}/${name}. Grant it access to that repository on GitHub, then try again.`,
    };
  }

  /*
   * The one entitlement this product has, checked server-side.
   *
   * /pricing promises public repositories are free and unlimited — no language
   * cap, no string cap, no seat cap — so there is deliberately no check here
   * for a public one. Private repositories are the paid capability, and the
   * check is a boolean rather than a counter because invariant 3 forbids
   * metering.
   */
  if (repository.private) {
    const allowed = await mayUsePrivateRepositories(organization.id);
    if (!allowed) {
      /*
       * This no longer means "buy a plan", and saying so would be false.
       *
       * Connecting a GitHub App installation grants the entitlement
       * (`20261003000100`), so a workspace reaching this has no installation
       * linked — or had a self-serve grant revoked when one was removed. The
       * remedy is a connection, not a purchase, and the old sentence sent
       * people to a checkout that does not exist.
       */
      return {
        error:
          'Private repositories are covered once this workspace has connected a GitHub App installation, and this one has not. Connect GitHub and try again — nothing here is behind a paid plan today.',
      };
    }
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from('projects')
    .update({
      repository_owner: repository.owner,
      repository_name: repository.name,
      repository_branch: repository.defaultBranch,
      repository_connected_at: new Date().toISOString(),
      root_dir: rootDir,
    })
    .eq('id', project.id);

  if (error)
    return { error: `Could not save the connection: ${error.message}` };

  revalidatePath(`/${orgSlug}/projects/${projectSlug}`);
  return {};
}

export async function disconnectRepository(
  orgSlug: string,
  projectSlug: string,
): Promise<void> {
  // Disconnecting only clears this project's own pointer, and RLS already
  // confines that to a workspace the caller belongs to.
  await requireSession();

  const organization = await findOrganization(orgSlug);
  if (!organization) return;
  const project = await findProject(organization.id, projectSlug);
  if (!project) return;

  const supabase = await createClient();
  await supabase
    .from('projects')
    .update({
      repository_owner: null,
      repository_name: null,
      repository_branch: null,
      repository_connected_at: null,
      // Cleared with the pointer it qualifies. A subdirectory outliving the
      // repository it was a subdirectory *of* is a value with nothing to mean.
      root_dir: null,
    })
    .eq('id', project.id);

  revalidatePath(`/${orgSlug}/projects/${projectSlug}`);
}
