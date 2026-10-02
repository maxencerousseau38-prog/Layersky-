import { HealthTable, type HealthTableRow } from '@/components/health-table';
import { Metric, MetricGrid } from '@/components/metric';
import { NotConnected } from '@/components/not-connected';
import { Page, PageHeader } from '@/components/page';
import {
  findGitHubInstallation,
  findOrganization,
  requireSession,
} from '@/lib/data/workspace';
import { listChecks, summarise } from '@/lib/i18n/health';
import { isSupabaseConfigured } from '@/lib/supabase/env';
import { Alert, EmptyState } from '@localize-infra/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

export const metadata: Metadata = { title: 'Health' };

/**
 * What the i18n guardrail has found on this workspace's pull requests.
 *
 * ## Why this page exists
 *
 * The guardrail has been running since #124 — it analyses a pull request,
 * publishes a GitHub Check, and since #132 opens a corrective pull request —
 * and until now none of it appeared in the product. Every screen in the
 * dashboard showed the legacy extraction pipeline, so the half of Layersky
 * that actually runs continuously was the half with no surface.
 *
 * ## It indexes; it never re-judges
 *
 * Every row is written by the webhook at the moment it published the check, and
 * read back here under RLS. Nothing on this page re-analyses a repository, and
 * `correctable` is stored rather than recomputed: `planCorrection` is the
 * authority on what is safe to fix, and a second rule in a React component
 * would promise fixes the correction then refuses.
 *
 * The GitHub Check and the corrective pull request are the artefacts; this is
 * a list of them. Both are linked from every row, because a summary that
 * cannot be traced back to the thing it summarises is the kind of number this
 * repository keeps having to retract.
 */
export default async function HealthPage({
  params,
}: {
  params: Promise<{ org: string }>;
}) {
  const { org } = await params;

  if (!isSupabaseConfigured()) {
    return (
      <Page>
        <PageHeader
          title="Health"
          purpose="Every i18n check Layersky has run on this workspace's pull requests, and what it could fix."
        />
        <NotConnected noun="health checks" />
      </Page>
    );
  }

  await requireSession();
  const organization = await findOrganization(org);
  // A workspace that exists but is not yours must look like one that does not.
  if (!organization) notFound();

  const [{ checks, truncated }, installation] = await Promise.all([
    listChecks(organization.id),
    findGitHubInstallation(organization.id),
  ]);

  const rows: HealthTableRow[] = checks.map((check) => ({
    id: check.id,
    repository: `${check.repositoryOwner}/${check.repositoryName}`,
    pullNumber: check.pullNumber,
    conclusion: check.conclusion,
    findingCount: check.findingCount,
    // Only meaningful once a correction has run. Before that the check has
    // findings and no verdict on them, which is `0`, not a guess.
    correctable: check.correctionRequested ?? 0,
    correctivePrNumber: check.correctivePrNumber,
    correctivePrUrl: check.correctivePrUrl,
    skipped: check.skippedReason !== null,
    createdAt: check.createdAt,
  }));

  const totals = summarise(checks);

  return (
    <Page>
      <PageHeader
        title="Health"
        purpose="Every i18n check Layersky has run on this workspace's pull requests, and what it could fix."
      />

      {/*
       * The empty state names what is missing and offers exactly one way to
       * create it (DESIGN.md §8) — and which one depends on why it is empty.
       * A workspace with no GitHub installation cannot receive a check at all;
       * telling it to open a pull request would be advice it cannot follow.
       */}
      {checks.length === 0 ? (
        installation ? (
          <EmptyState
            title="No checks yet"
            description="Layersky checks a pull request when one is opened or pushed to on a repository this workspace's GitHub App can see. Open one, and the result appears here."
            action={
              <Link
                href={`/${org}/start`}
                className="rounded-sm text-body text-link underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
              >
                Review your setup
              </Link>
            }
          />
        ) : (
          <EmptyState
            title="GitHub is not connected"
            description="Layersky reads pull requests through a GitHub App installation. Connect one and checks start arriving on their own — there is nothing to schedule."
            action={
              <Link
                href={`/${org}/start`}
                className="rounded-sm text-body text-link underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
              >
                Connect GitHub
              </Link>
            }
          />
        )
      ) : (
        <>
          {/*
           * Three totals the table does not already carry. No check count —
           * the toolbar states it, and a tile repeating it forty pixels higher
           * is chrome, which is the rule `/runs` already follows.
           */}
          <MetricGrid label="Health across this workspace" columns={3}>
            <Metric
              label="Repositories checked"
              value={String(totals.repositories)}
            />
            <Metric
              label="Problems found"
              value={String(totals.openProblems)}
              note="Across the checks below."
            />
            <Metric
              label="Translations written"
              value={String(totals.correctedKeys)}
              note="By the automatic correction, into corrective pull requests."
            />
          </MetricGrid>

          {truncated ? (
            <Alert tone="neutral">
              Showing the 50 most recent checks. The totals above cover those,
              not every check this workspace has ever had.
            </Alert>
          ) : null}

          <HealthTable checks={rows} orgSlug={org} />
        </>
      )}
    </Page>
  );
}
