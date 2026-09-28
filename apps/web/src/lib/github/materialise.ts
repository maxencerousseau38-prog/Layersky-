import 'server-only';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { App } from 'octokit';
import { readGitHubApp } from './config';
import { installationIdFor } from './repositories';

/**
 * Copies a repository into a temporary directory so packages/core can read it.
 *
 * `packages/core` walks a filesystem — it detects a framework by looking for a
 * config file and extracts strings by parsing source with ts-morph. Rewriting
 * it to read from an API would fork the one piece of this product that is
 * already proven, so the repository is brought to it instead.
 *
 * The tree is fetched recursively in one request and only source-shaped files
 * are downloaded. A repository with a large binary in it would otherwise cost
 * a blob request per file and a great deal of memory for data no parser reads.
 */
export interface Materialised {
  dir: string;
  fileCount: number;
  truncated: boolean;
}

/** Extensions the extractor can do something with, plus the config files detection needs. */
const WANTED = /\.(tsx?|jsx?|json|mjs|cjs)$/i;

/** Directories that never contain source worth parsing. */
const SKIP =
  /(^|\/)(node_modules|\.git|\.next|dist|build|coverage|\.turbo)(\/|$)/;

/** A blob larger than this is not hand-written source. */
const MAX_BLOB_BYTES = 512 * 1024;

/**
 * Resolves a repository-relative path inside `dir`, or returns null.
 *
 * The path comes from GitHub's tree API, which reports what is in the tree
 * object — and a tree can be written with git's plumbing, so its contents are
 * attacker-controlled by whoever owns the repository. That was tolerable while
 * the only reachable repositories were ours. It stops being tolerable the
 * moment a customer installs the App on a repository they wrote, which is the
 * next thing this product does.
 *
 * `join(dir, '../../x')` happily escapes the temporary directory and the write
 * lands wherever it points. So containment is checked after resolution rather
 * than by inspecting the string: `resolve` collapses the traversal first, and
 * `relative` then answers the only question that matters — is the result still
 * under `dir`.
 */
export function safeTargetPath(dir: string, repoPath: string): string | null {
  // A NUL truncates the path at the syscall boundary, so "a\0../../x" can be
  // one thing to this check and another to the filesystem.
  if (repoPath.includes('\0')) return null;

  const segments = repoPath.split('/');
  if (segments.some((segment) => segment === '..')) return null;
  if (isAbsolute(repoPath) || /^[A-Za-z]:/.test(repoPath)) return null;

  const target = resolve(dir, segments.join(sep));
  const inside = relative(dir, target);
  if (inside === '' || inside.startsWith('..') || isAbsolute(inside)) {
    return null;
  }
  return target;
}

export async function materialiseRepository(
  owner: string,
  repo: string,
  ref: string,
  organizationId: string | null = null,
  /*
   * The installation, when the caller already knows it.
   *
   * A run started from the browser knows a workspace and derives the
   * installation from it. A webhook knows the installation and nothing else —
   * the delivery carries `installation.id`, and there may be no workspace row
   * for that repository at all. Passing it in is the difference between
   * reusing this function and writing a second tarball reader beside it.
   *
   * It does not widen anything: an installation token still reaches only what
   * that installation was granted, which is the guarantee this has always
   * rested on.
   */
  installationOverride: number | null = null,
): Promise<Materialised> {
  const config = readGitHubApp();
  if (!config) throw new Error('No GitHub App configured');

  // The workspace's own installation when it has one. Reading a customer's
  // repository through the shared installation would work only for
  // repositories the operator was granted, and would be the wrong token to use
  // even then.
  const installationId =
    installationOverride ?? (await installationIdFor(organizationId));
  if (!installationId)
    throw new Error('No GitHub installation for this workspace');

  const app = new App({ appId: config.appId, privateKey: config.privateKey });
  const octokit = await app.getInstallationOctokit(installationId);

  const { data: tree } = await octokit.request(
    'GET /repos/{owner}/{repo}/git/trees/{tree_sha}',
    { owner, repo, tree_sha: ref, recursive: '1' },
  );

  const wanted = (tree.tree ?? []).filter(
    (entry) =>
      entry.type === 'blob' &&
      typeof entry.path === 'string' &&
      WANTED.test(entry.path) &&
      !SKIP.test(entry.path) &&
      (entry.size ?? 0) <= MAX_BLOB_BYTES,
  );

  const dir = await mkdtemp(join(tmpdir(), 'localize-run-'));

  // Sequential rather than parallel: the installation token is rate-limited per
  // hour, and a burst of a hundred blob requests is the fastest way to spend
  // that budget on a repository nobody is waiting on.
  let written = 0;
  for (const entry of wanted) {
    if (!entry.path || !entry.sha) continue;

    const { data: blob } = await octokit.request(
      'GET /repos/{owner}/{repo}/git/blobs/{file_sha}',
      { owner, repo, file_sha: entry.sha },
    );

    // Refused rather than sanitised: a repository containing a traversing path
    // is not a repository this product should quietly half-extract.
    const target = safeTargetPath(dir, entry.path);
    if (!target) {
      throw new Error(
        `Refusing to extract ${entry.path}: it resolves outside the working directory.`,
      );
    }

    const contents = Buffer.from(blob.content, 'base64');
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, contents);
    written += 1;
  }

  return {
    dir,
    fileCount: written,
    // GitHub truncates very large trees. Saying so beats silently extracting
    // from half a repository and reporting a confident key count.
    truncated: Boolean(tree.truncated),
  };
}
