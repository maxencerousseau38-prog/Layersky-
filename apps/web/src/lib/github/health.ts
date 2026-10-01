import 'server-only';
import type { AvailableRepository } from './repositories';
import { listInstallationRepositories } from './repositories';

/**
 * Whether the workspace's GitHub installation still works — asked, not assumed.
 *
 * `organization_github_installations` holding a row proves that somebody
 * completed the OAuth flow once. It does not prove the installation still
 * exists: an owner can uninstall the App from GitHub's own settings at any
 * time, and nothing tells this application when they do. The row survives, the
 * panel keeps saying "Connected", and the first thing to discover otherwise is
 * a run that fails after every locale has been translated and paid for.
 *
 * So this asks GitHub. It is deliberately **on demand** rather than on render:
 * the answer changes rarely, the question costs a network round trip and
 * GitHub rate limit on a page people reload, and a check nobody asked for that
 * silently fails is worse than no check.
 *
 * Read-only in every branch. It lists what the installation was granted; it
 * creates nothing, and it is safe to run as often as somebody presses the
 * button.
 */

export type InstallationHealth =
  | {
      ok: true;
      /** How many repositories the installation was granted. */
      repositories: number;
      /** A few names, so the reader can tell it is the right account. */
      sample: string[];
    }
  | {
      ok: false;
      /** What is wrong, and what to do about it. */
      problem: string;
      /**
       * The provider's own words, when there are any worth showing.
       * DESIGN.md §8: error states reproduce machine output verbatim.
       */
      detail: string | null;
    };

/** Whatever Octokit threw, as a status code when it carries one. */
function statusOf(error: unknown): number | null {
  if (typeof error !== 'object' || error === null) return null;
  const status = (error as { status?: unknown }).status;
  return typeof status === 'number' ? status : null;
}

function messageOf(error: unknown): string | null {
  if (error instanceof Error && error.message) return error.message;
  return null;
}

/**
 * A GitHub failure, in terms of the thing the reader can go and fix.
 *
 * Pure, and separated from the call so that every branch is reachable in a
 * test — the interesting ones (401, 404, rate limit) are precisely the ones a
 * healthy test account cannot produce on demand.
 */
export function explainGitHubFailure(error: unknown): {
  problem: string;
  detail: string | null;
} {
  const status = statusOf(error);
  const detail = messageOf(error);

  if (status === 404) {
    return {
      problem:
        'GitHub does not recognise this installation any more. It was most likely uninstalled from the GitHub account. Connect GitHub again to create a new one.',
      detail,
    };
  }
  if (status === 401 || status === 403) {
    return {
      problem:
        'GitHub refused this deployment’s App credentials. This is an operator problem, not something you can fix from here: the App id or private key is wrong or expired.',
      detail,
    };
  }
  if (status === 429) {
    return {
      problem:
        'GitHub is rate-limiting this App. Nothing is wrong with your installation; wait a minute and check again.',
      detail,
    };
  }
  if (status !== null && status >= 500) {
    return {
      problem:
        'GitHub itself returned an error. Your installation is probably fine — check again in a moment, or look at githubstatus.com.',
      detail,
    };
  }
  return {
    problem:
      'Could not reach GitHub to check this installation, so whether it works is unknown. This is not evidence that it is broken.',
    detail,
  };
}

const SAMPLE_SIZE = 5;

export async function checkInstallationHealth(
  organizationId: string,
): Promise<InstallationHealth> {
  let repositories: Awaited<ReturnType<typeof listInstallationRepositories>>;
  try {
    repositories = await listInstallationRepositories(organizationId);
  } catch (error) {
    // Logged whole, reported in words. The App's own credentials can appear in
    // an Octokit error, and this string is rendered to a customer.
    console.error('installation health check failed:', error);
    const { problem, detail } = explainGitHubFailure(error);
    return { ok: false, problem, detail };
  }

  if (repositories.length === 0) {
    /*
     * Not an error, and not success either. The call worked; the installation
     * simply has no repository selected — which is the single most common way
     * a connected workspace still cannot open a pull request, and it is
     * invisible from the row in the database.
     */
    return {
      ok: false,
      problem:
        'The installation works, but it was granted no repositories. Open it on GitHub and select at least one, then check again.',
      detail: null,
    };
  }

  return {
    ok: true,
    repositories: repositories.length,
    sample: repositories.slice(0, SAMPLE_SIZE).map((repo) => repo.fullName),
  };
}

/**
 * The repository list, for a surface that must render whatever GitHub says.
 *
 * ## The failure this replaces
 *
 * `/[org]/projects/[project]` called `listInstallationRepositories` directly
 * while rendering. That function throws whatever Octokit throws, and when the
 * stored installation no longer exists GitHub answers **404** to the
 * access-token request — so the whole page became an HTTP 500 with an empty
 * `<main>`. Observed, not theorised: after the App was reinstalled on
 * 2026-09-29 the dev workspace still pointed at the deleted installation, and
 * every project page returned 500 until the row was corrected.
 *
 * An owner uninstalling the App from GitHub's settings produces exactly that
 * state, and nothing tells this application when they do — the case the module
 * above already exists for. A customer hitting it got a server error rather
 * than a page saying what to do.
 *
 * ## Why not a try/catch at the call site
 *
 * Because then the page would have to decide what a 404 means, and a second
 * place deciding that is a second place to get it wrong. `explainGitHubFailure`
 * above already classifies 404, 401/403, 429, 5xx and unreachable in the terms
 * of the person who can fix each one. This reuses it.
 *
 * ## `reconnect` is set for 404 and nothing else
 *
 * That flag is the one that tells a reader to connect GitHub again, and it is
 * only true when GitHub has said the installation is gone. A 401 is the
 * *operator's* credentials, a 429 is a rate limit, a 5xx is GitHub — none of
 * them is fixed by reconnecting, and telling a customer to reconnect would
 * send them to redo work that was never broken. There is a test per branch.
 */
export type RepositoryAccess =
  | { ok: true; repositories: AvailableRepository[] }
  | {
      ok: false;
      problem: string;
      detail: string | null;
      /** True only when GitHub reported the installation as gone. */
      reconnect: boolean;
    };

/** Octokit's status code, when the thrown value carries one. */
function isInstallationGone(error: unknown): boolean {
  return statusOf(error) === 404;
}

export async function readInstallationRepositories(
  organizationId: string | null,
): Promise<RepositoryAccess> {
  try {
    return {
      ok: true,
      repositories: await listInstallationRepositories(organizationId),
    };
  } catch (error) {
    /*
     * Logged whole, reported as one sentence. An Octokit error can carry the
     * App's own credentials in its request context, and `problem` is rendered
     * to a customer — the same rule `/v1/translate` follows after it returned
     * a provider error quoting an OpenAI key.
     */
    console.error('could not list installation repositories:', error);
    const { problem, detail } = explainGitHubFailure(error);
    return { ok: false, problem, detail, reconnect: isInstallationGone(error) };
  }
}
