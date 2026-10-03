import type {
  GitHubAppConfig,
  Octokit,
  OpenPrRequest,
  OpenPrResult,
  RepositoryAccess,
} from '@localize-infra/github-app';
import {
  OpenPrApiRequestSchema,
  OpenPrApiResponseSchema,
  PreflightRequestSchema,
} from '@localize-infra/schemas';
import { type Caller, OPERATOR } from '../callers.js';

const HEAD_BRANCH_PREFIX = 'localize-infra/add-translations';

export interface GitHubAppOperations {
  createClient: (config: GitHubAppConfig) => Promise<Octokit>;
  openPr: (octokit: Octokit, request: OpenPrRequest) => Promise<OpenPrResult>;
  /**
   * Two reads, no writes. Required for workspace callers, whose private
   * repositories are gated by entitlement; operator callers skip it.
   */
  checkAccess?: (
    octokit: Octokit,
    target: { owner: string; repo: string; baseBranch: string },
  ) => Promise<RepositoryAccess>;
}

/**
 * Where the web app tells a workspace to connect GitHub. A message that says
 * "connect GitHub" without saying where is half an instruction.
 */
const WEB_APP_URL =
  process.env.LOCALIZE_WEB_URL ?? 'https://localize-infra-web.vercel.app';

type Resolved =
  | { ok: true; installationId: number }
  | { ok: false; status: number; body: { error: string } };

/**
 * Which installation this caller may act through.
 *
 * A workspace caller acts through its workspace's installation and nothing
 * else: a request naming a different one is refused, and there is no fallback
 * to the deployment's default — that default is the operator's installation,
 * and falling back to it is exactly how a shared token reached repositories
 * that were never the caller's.
 */
function resolveInstallation(
  caller: Caller,
  requested: number | undefined,
  defaultInstallationId: number | null,
): Resolved {
  if (caller.kind === 'workspace') {
    if (caller.installationId === null) {
      return {
        ok: false,
        status: 412,
        body: {
          error: `Workspace "${caller.organizationSlug}" has no GitHub connection, so no pull request can be opened. Connect GitHub at ${WEB_APP_URL}/${caller.organizationSlug}/projects and run again.`,
        },
      };
    }
    if (requested !== undefined && requested !== caller.installationId) {
      return {
        ok: false,
        status: 403,
        body: {
          error:
            'This token can only act through its own workspace’s GitHub installation.',
        },
      };
    }
    return { ok: true, installationId: caller.installationId };
  }

  const installationId = requested ?? defaultInstallationId;
  if (installationId === null) {
    return {
      ok: false,
      status: 501,
      body: {
        error:
          'No GitHub App installation to act as: the request carried no installationId and GITHUB_APP_INSTALLATION_ID is not set.',
      },
    };
  }
  return { ok: true, installationId };
}

type Refusal = { status: number; body: { error: string } };

/**
 * The access check, with the refusals worded for the person who can fix them.
 * Returns null when the pull request may proceed.
 */
async function refuseInaccessible(
  caller: Caller,
  ops: GitHubAppOperations,
  octokit: Octokit,
  target: { owner: string; repo: string; baseBranch: string },
): Promise<Refusal | null> {
  if (!ops.checkAccess) {
    if (caller.kind === 'workspace') {
      throw new Error('checkAccess is required for workspace callers');
    }
    return null;
  }
  return describeAccessRefusal(
    caller,
    await ops.checkAccess(octokit, target),
    target,
  );
}

function describeAccessRefusal(
  caller: Caller,
  access: RepositoryAccess,
  target: { owner: string; repo: string; baseBranch: string },
): Refusal | null {
  const where = `${target.owner}/${target.repo}`;
  const who =
    caller.kind === 'workspace'
      ? `the GitHub installation connected to workspace "${caller.organizationSlug}"`
      : 'this deployment’s GitHub installation';

  if (!access.ok && access.reason === 'repository_unreachable') {
    return {
      status: 404,
      body: {
        error: `${where} is not reachable by ${who}. Check the owner and repository names, or grant the Localize Infra GitHub App access to that repository.`,
      },
    };
  }
  if (!access.ok) {
    return {
      status: 422,
      body: {
        error: `Branch "${target.baseBranch}" does not exist in ${where}. Its default branch is "${access.defaultBranch}" — pass --base-branch ${access.defaultBranch}.`,
      },
    };
  }
  if (
    caller.kind === 'workspace' &&
    access.private &&
    !caller.privateRepositories
  ) {
    return {
      status: 403,
      body: {
        /*
         * Not "limited to public repositories", which read as a plan ceiling.
         * `apps/web` grants this entitlement when a workspace connects a
         * GitHub App installation, so a caller reaching this has none linked.
         */
        error: `${where} is private, and workspace "${caller.organizationSlug}" has no GitHub App installation connected. Connect GitHub in the dashboard and run this again.`,
      },
    };
  }
  return null;
}

/**
 * A GitHub failure, described by its status and nothing else from the
 * response — GitHub error bodies can carry rate-limit and permission details
 * that are not this caller's business.
 */
function describeGitHubFailure(error: unknown, where: string) {
  const status =
    typeof error === 'object' && error !== null && 'status' in error
      ? (error as { status: unknown }).status
      : null;
  if (status === 403) {
    return {
      status: 403,
      body: {
        error: `GitHub refused to write to ${where} (403). The Localize Infra GitHub App needs contents and pull request write access to it.`,
      },
    };
  }
  if (status === 404) {
    return {
      status: 404,
      body: {
        error: `GitHub reported ${where} or its base branch as not found (404) while opening the pull request.`,
      },
    };
  }
  if (status === 422) {
    return {
      status: 422,
      body: {
        error: `GitHub rejected the pull request for ${where} (422). A branch or pull request with the same content may already exist.`,
      },
    };
  }
  return {
    status: 502,
    body: {
      error: 'Failed to open pull request. Check server logs for details.',
    },
  };
}

/**
 * `POST /v1/open-pr/preflight` — may a pull request be opened here? Asked by
 * the CLI before it translates anything, so a wrong repository or branch
 * costs nothing.
 */
export async function preflightRouteHandler(
  body: unknown,
  env: OpenPrEnvironment,
  ops: GitHubAppOperations,
  caller: Caller = OPERATOR,
): Promise<{ status: number; body: unknown }> {
  if (!env.app) {
    return {
      status: 501,
      body: {
        error:
          'GitHub App is not configured (GITHUB_APP_ID/GITHUB_APP_PRIVATE_KEY missing)',
      },
    };
  }
  const parsed = PreflightRequestSchema.safeParse(body);
  if (!parsed.success) {
    return {
      status: 400,
      body: { error: 'Invalid request body', details: parsed.error.flatten() },
    };
  }
  const installation = resolveInstallation(
    caller,
    undefined,
    env.defaultInstallationId,
  );
  if (!installation.ok) return installation;
  if (!ops.checkAccess) {
    return { status: 501, body: { error: 'Preflight is not available.' } };
  }

  const target = parsed.data;
  try {
    const octokit = await ops.createClient({
      ...env.app,
      installationId: installation.installationId,
    });
    const access = await ops.checkAccess(octokit, target);
    const refusal = describeAccessRefusal(caller, access, target);
    if (refusal) return refusal;
    return {
      status: 200,
      body: {
        ok: true,
        repository: `${target.owner}/${target.repo}`,
        baseBranch: target.baseBranch,
        private: access.ok ? access.private : false,
      },
    };
  } catch (err) {
    console.error('preflight failed:', err);
    return describeGitHubFailure(err, `${target.owner}/${target.repo}`);
  }
}

/**
 * What the App is, kept apart from which installation to act as.
 *
 * These used to be one `GitHubAppConfig`, which is what made every tenant's
 * pull request come out of the operator's installation: the identity of the
 * App and the choice of installation arrived together, from the environment,
 * with no way for a request to influence the second. `apps/web` split the same
 * pair in #24 for the read path and the isolation followed from the split; this
 * is that split applied to the write path.
 *
 * `defaultInstallationId` is a fallback for single-tenant deployments, not a
 * shared installation for multi-tenant ones — see `installationId` on
 * `OpenPrApiRequestSchema` for which caller relies on which.
 */
export interface OpenPrEnvironment {
  app: { appId: string; privateKey: string } | null;
  defaultInstallationId: number | null;
}

export async function openPrRouteHandler(
  body: unknown,
  env: OpenPrEnvironment,
  ops: GitHubAppOperations,
  caller: Caller = OPERATOR,
): Promise<{ status: number; body: unknown }> {
  if (!env.app) {
    return {
      status: 501,
      body: {
        error:
          'GitHub App is not configured (GITHUB_APP_ID/GITHUB_APP_PRIVATE_KEY missing)',
      },
    };
  }

  const parsed = OpenPrApiRequestSchema.safeParse(body);
  if (!parsed.success) {
    return {
      status: 400,
      body: { error: 'Invalid request body', details: parsed.error.flatten() },
    };
  }

  /*
   * The request wins over the environment, and a request that names no
   * installation on a service configured with no default is refused rather
   * than guessed at. 501 rather than 400 because the caller's request is
   * well-formed — it is this deployment that cannot serve it.
   */
  const installation = resolveInstallation(
    caller,
    parsed.data.installationId,
    env.defaultInstallationId,
  );
  if (!installation.ok) return installation;
  const { installationId } = installation;
  const where = `${parsed.data.owner}/${parsed.data.repo}`;

  try {
    const octokit = await ops.createClient({ ...env.app, installationId });
    /*
     * Checked again here, not only in preflight: a published CLI older than
     * 0.3.0 never calls preflight, and the private-repository rule must hold
     * for every caller that can reach this route.
     */
    const refusal = await refuseInaccessible(caller, ops, octokit, {
      owner: parsed.data.owner,
      repo: parsed.data.repo,
      baseBranch: parsed.data.baseBranch,
    });
    if (refusal) return refusal;
    const result = await ops.openPr(octokit, {
      owner: parsed.data.owner,
      repo: parsed.data.repo,
      baseBranch: parsed.data.baseBranch,
      headBranch: `${HEAD_BRANCH_PREFIX}-${Date.now()}`,
      title: parsed.data.title,
      body: parsed.data.body,
      files: parsed.data.files,
    });
    /*
     * Nothing to open is not a failure, and not a success carrying a URL that
     * does not exist. It gets its own status.
     *
     * 409 rather than a widened 200 body, and that choice is about a package
     * already on npm. `@localize-infra/cli@0.1.0` parses the 200 body with a
     * strict schema requiring `prUrl` and `prNumber`, so a 200 without them
     * makes that published client throw a raw ZodError. It already handles a
     * non-2xx by throwing with the status and body text, so a 409 reaches its
     * user as a readable sentence instead — worse than a typed outcome, far
     * better than the empty pull request it opens today.
     */
    if (!result.opened) {
      return {
        status: 409,
        body: {
          error:
            'Nothing to open: the files in this request are identical to the base branch.',
        },
      };
    }

    return {
      status: 200,
      body: OpenPrApiResponseSchema.parse({
        prUrl: result.prUrl,
        prNumber: result.prNumber,
      }),
    };
  } catch (err) {
    // Log the full error server-side for the operator's own diagnostics, but
    // never echo it back to the caller: Octokit/GitHub errors can contain
    // rate-limit details, repo internals, or auth hints that shouldn't leak
    // to whoever can reach this endpoint.
    console.error('open-pr failed:', err);
    return describeGitHubFailure(err, where);
  }
}
