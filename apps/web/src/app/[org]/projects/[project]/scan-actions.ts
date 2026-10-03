'use server';

import { existsSync, statSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import {
  findOrganization,
  findProject,
  mayUsePrivateRepositories,
  requireSession,
} from '@/lib/data/workspace';
import { materialiseRepository } from '@/lib/github/materialise';
import { canReachRepository } from '@/lib/github/repositories';
import { type Coverage, buildCoverage } from '@/lib/runs/coverage';
import {
  buildKeyCatalog,
  detectFramework,
  extractFromProject,
  readLocaleFile,
  repoRelativePath,
} from '@localize-infra/core';

/**
 * Look at a repository and say what a run would do, without doing it.
 *
 * The brief's first-value screen wants real numbers before a developer commits
 * to anything: how many keys, how many locales, how much is missing. Every one
 * of those was already computed — but only *during* a run, interleaved with the
 * model calls that cost money. A developer had to pay to find out whether it
 * was worth paying.
 *
 * This is the same first half of the pipeline, stopping where the spending
 * starts. It calls `materialiseRepository`, `detectFramework`,
 * `extractFromProject` and `readLocaleFile` — the run's own functions, not
 * copies — so what it reports and what the run does cannot drift.
 *
 * **It writes nothing.** No `runs` row is created, deliberately: a scan is not
 * a run, and inserting one would put a row that translated nothing into the
 * activation funnel and into the history a developer reads. The cost of
 * recomputing on the next visit is a tarball and a directory walk, with no
 * model call in it.
 */

export interface ScanState {
  error?: string;
  scan?: {
    framework: string;
    sourceLocale: string;
    localesDir: string;
    coverage: Coverage;
  };
}

export async function scanProject(
  _previous: ScanState,
  form: FormData,
): Promise<ScanState> {
  await requireSession();

  const orgSlug = String(form.get('orgSlug') ?? '');
  const projectSlug = String(form.get('projectSlug') ?? '');

  const organization = await findOrganization(orgSlug);
  if (!organization) return { error: 'That workspace is not available.' };

  const project = await findProject(organization.id, projectSlug);
  if (!project) return { error: 'That project is not available.' };

  if (!project.repository_owner || !project.repository_name) {
    return { error: 'Connect a repository before scanning.' };
  }

  /*
   * The same two checks the run makes, in the same order. A scan reads the
   * repository, so it needs exactly the permission a run needs — asking less
   * here would make the scan a way to read a repository the run would refuse.
   */
  /*
   * The arguments used to be positional, and this call had them shifted one
   * place left — it asked whether a repository *named after the workspace's
   * UUID* existed. None does, so this returned null every time and the scan
   * refused every repository, including the ones it could reach.
   */
  const repository = await canReachRepository({
    owner: project.repository_owner,
    name: project.repository_name,
    organizationId: organization.id,
  });
  if (!repository) {
    return {
      error:
        'This workspace cannot reach that repository. Check the installation on GitHub.',
    };
  }
  if (
    repository.private &&
    !(await mayUsePrivateRepositories(organization.id))
  ) {
    // Not a plan. See `connect-actions.ts`: the entitlement follows the
    // GitHub installation, so the remedy is connecting one.
    return {
      error:
        'Private repositories are covered once this workspace has connected a GitHub App installation. Connect GitHub and try again.',
    };
  }

  let workdir: string | null = null;
  try {
    const materialised = await materialiseRepository(
      project.repository_owner,
      project.repository_name,
      project.repository_branch ?? 'main',
      organization.id,
    );
    workdir = materialised.dir;

    if (materialised.truncated) {
      // Same refusal as the run, and for the same reason: a partial checkout
      // would produce a key count that looks complete and is not.
      return {
        error:
          'GitHub truncated the repository tree, so the count would have been taken against an incomplete checkout.',
      };
    }

    /*
     * Where the project actually is, which is not always the checkout root.
     *
     * Detection and extraction both take this rather than `workdir`. Reading
     * happens *inside* the checkout; the paths this function reports back are
     * relative to the **repository**, which is a different thing and the reason
     * `repoRelativePath` exists.
     */
    const rootDir = project.root_dir;
    const projectDir = rootDir ? join(workdir, rootDir) : workdir;

    if (!existsSync(projectDir) || !statSync(projectDir).isDirectory()) {
      // Named before detection runs, because "No supported framework detected"
      // is what a missing directory would otherwise report — sending someone
      // to look for a framework problem when they have a typo.
      return {
        error: `This project is set to the subdirectory ${rootDir}, which does not exist on branch ${project.repository_branch ?? 'main'}. Check the path, or clear it to scan the repository root.`,
      };
    }

    const detected = detectFramework(projectDir);
    if (!detected) {
      return {
        error: rootDir
          ? `No supported framework detected in ${rootDir}. Supported: Next.js, Vite + React, React Native.`
          : 'No supported framework detected. Supported: Next.js, Vite + React, React Native. If this is a monorepo, set the subdirectory the app lives in.',
      };
    }

    const fresh = buildKeyCatalog(
      extractFromProject(projectDir, detected.sourceGlobs),
    );
    if (Object.keys(fresh).length === 0) {
      return {
        error:
          'No translatable strings were found. Nothing here needs localizing yet.',
      };
    }

    const localesDir = join(projectDir, detected.localesDir);
    const existing: Record<string, Record<string, string>> = {};
    for (const locale of project.target_locales) {
      existing[locale] = readLocaleFile(localesDir, locale);
    }

    return {
      scan: {
        framework: detected.name,
        sourceLocale: project.source_locale,
        // Reported relative to the repository, not to the checkout: this is
        // the path a developer will look for in their own tree.
        localesDir: repoRelativePath(rootDir, detected.localesDir),
        coverage: buildCoverage(fresh, existing, project.target_locales),
      },
    };
  } catch (error) {
    return {
      error: `Could not scan the repository: ${error instanceof Error ? error.message : String(error)}`,
    };
  } finally {
    // The checkout is a temporary directory this request owns. Leaving it
    // behind would fill the disk one scan at a time.
    if (workdir) await rm(workdir, { recursive: true, force: true });
  }
}
