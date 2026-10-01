import { Page, PageHeader, PageMeta } from '@/components/page';
import {
  currentRole,
  findOrganization,
  findProject,
  listRunAmbiguities,
  listRunTranslations,
  listRuns,
  projectDeletionImpact,
  requireSession,
} from '@/lib/data/workspace';
import { isGitHubConfigured } from '@/lib/github/config';
import {
  type RepositoryAccess,
  readInstallationRepositories,
} from '@/lib/github/health';
import { installationIdFor } from '@/lib/github/repositories';
import { runAvailability } from '@/lib/runs/availability';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { DangerSection } from './danger-section';
import { LocalesSection } from './locales-section';
import { RepositorySection } from './repository-section';
import { ReviewSection } from './review-section';
import { RunsSection } from './runs-section';
import { ScanSection } from './scan-section';

export const metadata: Metadata = { title: 'Project' };

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ org: string; project: string }>;
}) {
  await requireSession();
  const { org, project: projectSlug } = await params;

  const organization = await findOrganization(org);
  if (!organization) notFound();

  const project = await findProject(organization.id, projectSlug);
  if (!project) notFound();

  /*
   * Repositories come from this workspace's own installation.
   *
   * The list used to be fetched only for an operator, against a shared
   * installation. It is now fetched only when this workspace has installed the
   * App itself — calling GitHub to render a section that will say "not
   * connected" is a network round trip to produce a sentence.
   */
  const gitHubConfigured = isGitHubConfigured();
  const installationId = gitHubConfigured
    ? await installationIdFor(organization.id)
    : null;
  /*
   * Read through the resilient path, because this runs while rendering.
   *
   * It called `listInstallationRepositories` directly, which throws whatever
   * Octokit throws — and a stored installation that no longer exists makes
   * GitHub answer 404 to the token request, so the page became an HTTP 500
   * with an empty `<main>`. An owner uninstalling the App from GitHub's
   * settings produces that state and nothing tells this application when they
   * do. `readInstallationRepositories` classifies the failure instead of
   * propagating it; the section below says what happened.
   */
  const access: RepositoryAccess = installationId
    ? await readInstallationRepositories(organization.id)
    : { ok: true, repositories: [] };
  const available = access.ok ? access.repositories : [];

  const runs = await listRuns(project.id);

  /*
   * Only for those who can actually delete. `projects_delete_admin` admits
   * owners and admins, so drawing the section for a member would be a control
   * that cannot work — the pattern refused next to `ScanSection` and in
   * `runAvailability`.
   *
   * The counts are fetched for the same audience, so a member's page does not
   * pay for three counts it will not render.
   */
  const role = await currentRole(organization.id);
  const mayDelete = role === 'owner' || role === 'admin';
  const deletionImpact = mayDelete
    ? await projectDeletionImpact(project.id)
    : null;

  /*
   * The review gate only has a subject when a run is actually waiting on one.
   *
   * Scoped to the newest such run rather than every one of them: two runs
   * waiting at once would mean two proposals for the same locale files, and
   * answering questions on the older one would commit a diff nobody looked at.
   * The two extra queries are skipped entirely when nothing is waiting.
   */
  const awaiting = runs.find((r) => r.status === 'awaiting_review') ?? null;
  const [ambiguities, proposals] = awaiting
    ? await Promise.all([
        listRunAmbiguities(awaiting.id),
        listRunTranslations(awaiting.id),
      ])
    : [[], []];
  const connected = Boolean(
    project.repository_owner && project.repository_name,
  );
  /*
   * One call, not two expressions. `canRun` and the reason used to be computed
   * independently and nothing made them agree — see `runAvailability` for what
   * that cost.
   */
  const { canRun, reason: runReason } = runAvailability({
    gitHubConfigured,
    installationId,
    connected,
    targetLocales: project.target_locales,
  });

  return (
    <Page>
      <PageHeader
        title={project.name}
        purpose="What this project points at, and which locales it ships."
        meta={
          <>
            <PageMeta label="Workspace">{organization.name}</PageMeta>
            <PageMeta label="Source">{project.source_locale}</PageMeta>
          </>
        }
      />

      <dl className="mt-6 grid gap-px overflow-hidden rounded-lg border border-subtle bg-subtle sm:grid-cols-2">
        <div className="bg-canvas px-4 py-3">
          <dt className="text-eyebrow font-medium uppercase text-tertiary">
            Address
          </dt>
          <dd className="mt-1 font-mono text-caption text-primary">
            /{org}/projects/{project.slug}
          </dd>
        </div>
      </dl>

      {/* Was a read-only row in the summary list above saying "None
          configured", which was accurate and offered nothing to press — there
          was no write path for this column anywhere in the app. It is a section
          now because it is a decision, and because a run without it fails
          before it reaches a model. */}
      <LocalesSection
        orgSlug={org}
        projectSlug={project.slug}
        sourceLocale={project.source_locale}
        targetLocales={project.target_locales}
      />

      <RepositorySection
        orgSlug={org}
        projectSlug={project.slug}
        connected={
          project.repository_owner && project.repository_name
            ? {
                owner: project.repository_owner,
                name: project.repository_name,
                branch: project.repository_branch,
                rootDir: project.root_dir,
              }
            : null
        }
        available={available}
        unavailable={access.ok ? null : access}
        hasInstallation={Boolean(installationId)}
        gitHubConfigured={gitHubConfigured}
      />

      {awaiting ? (
        <ReviewSection
          runId={awaiting.id}
          org={org}
          project={project.slug}
          ambiguities={ambiguities}
          proposals={proposals}
        />
      ) : null}

      {/*
        Before the run, because it answers the question the run costs money to
        answer. Same gate as the run: reading the repository needs the same
        installation, so offering a scan where a run is impossible would be a
        button that cannot work.
      */}
      <ScanSection
        orgSlug={org}
        projectSlug={project.slug}
        canScan={Boolean(installationId) && connected}
      />

      <RunsSection
        orgSlug={org}
        projectSlug={project.slug}
        canRun={canRun}
        reason={runReason}
        runs={runs.map((run) => ({
          id: run.id,
          status: run.status,
          stage: run.stage,
          framework: run.framework,
          keysExtracted: run.keys_extracted,
          keysTranslated: run.keys_translated,
          localesSucceeded: run.locales_succeeded,
          localesFailed: run.locales_failed,
          error: run.error,
          prUrl: run.pr_url,
          prNumber: run.pr_number,
          createdAt: run.created_at,
          progressAt: run.progress_at,
        }))}
      />

      {mayDelete && deletionImpact ? (
        <DangerSection
          orgSlug={org}
          projectId={project.id}
          projectSlug={project.slug}
          impact={deletionImpact}
        />
      ) : null}
    </Page>
  );
}
