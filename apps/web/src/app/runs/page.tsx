import { Metric, MetricGrid } from '@/components/metric';
import { NotConnected } from '@/components/not-connected';
import { Page, PageHeader, PageMeta } from '@/components/page';
import { type RunTableRow, RunsTable } from '@/components/runs-table';
import { listRunsForViewer, requireSession } from '@/lib/data/workspace';
import { toRunTableRow } from '@/lib/runs/table-row';
import { isSupabaseConfigured } from '@/lib/supabase/env';
import { Badge, EmptyState } from '@localize-infra/ui';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Runs' };

/**
 * Every run this person can see, across their workspaces.
 *
 * This rendered three invented runs — a clean one, a partial one and a failure
 * — behind a banner saying so, because nothing recorded a real one. The `runs`
 * table has existed since #14 and the pipeline has been writing to it since;
 * RLS confines reads to workspaces the caller belongs to.
 *
 * The header carried "Last run: 2 hours ago" and "Succeeded: 1 of 3" as literal
 * text. Both are computed now, and both are absent when there is nothing to
 * count rather than reading zero — a zero implies a measurement was taken.
 */
export default async function RunsPage() {
  // Before the session check: without a database there is no session to
  // require, and `requireSession` would throw where a sentence belongs.
  if (!isSupabaseConfigured()) {
    return (
      <Page>
        {/* The header stays. A page whose only content is an empty state
            still needs its one h1 — dropping it made this route headingless,
            which is an accessibility failure and not a test artefact. */}
        <PageHeader
          title="Runs"
          purpose="Every extraction and translation, what it produced, and what it cost you in time."
        />
        <NotConnected noun="runs" />
      </Page>
    );
  }

  await requireSession();
  const { runs, truncated } = await listRunsForViewer();

  const succeeded = runs.filter((r) => r.status === 'succeeded').length;
  const newest = runs[0];

  /*
   * The three facts the table does not already total, and no more.
   *
   * Deliberately absent: strings translated. `/[org]/usage` reports that from
   * `api_usage_daily` — the row the ceiling is enforced against — and its own
   * docstring explains why it never re-derives it from `runs`. Summing
   * `keys_translated` here would be that second tally, on another page, free
   * to disagree with the number the API actually refuses against.
   *
   * Also absent: a run count. The toolbar below states it, which §8 requires,
   * and a tile repeating it forty pixels higher is chrome.
   */
  const needsYou = runs.filter((r) => r.status === 'awaiting_review').length;
  const pullRequests = runs.filter((r) => r.pr_number !== null).length;
  // Every total above is over the runs on this page. Past fifty that is not
  // every run, and a total that looks complete while being a window is the
  // kind of claim this repository keeps having to retract.
  const window = truncated ? 'Across the 50 most recent runs.' : null;

  // Shared with /[org]/usage, which renders the same table. The mapping lived
  // here until a second surface needed it (lib/runs/table-row.ts).
  const rows: RunTableRow[] = runs.map(toRunTableRow);

  return (
    <Page>
      <PageHeader
        title="Runs"
        purpose="Every extraction and translation, what it produced, and what it cost you in time."
        meta={
          newest ? (
            <PageMeta label="Last run">
              {new Date(newest.created_at).toISOString().slice(0, 10)}
            </PageMeta>
          ) : null
        }
      />

      {/*
        Succeeded moved out of the header and into a tile beside two facts the
        header never carried. It was one of two items in a `caption`-sized
        metadata row, which is the right size for a timestamp and the wrong one
        for the answer to "is this working".
      */}
      {runs.length > 0 ? (
        <div className="mt-6">
          <MetricGrid label="Summary of these runs" columns={3}>
            <Metric
              label="Needs your call"
              value={needsYou}
              note="Stopped on a question only you can answer."
              badge={
                /* Iris, and only when there is something to answer. DESIGN.md
                   §1.4 reserves this tone for "your judgement is required";
                   zero of them is not a state (§6.3). */
                needsYou > 0 ? <Badge tone="ambiguous">Waiting</Badge> : null
              }
            />
            <Metric
              label="Succeeded"
              value={`${succeeded} of ${runs.length}`}
              note="Every target locale delivered."
            />
            <Metric
              label="Pull requests opened"
              value={pullRequests}
              note="Shipped to your repository."
            />
          </MetricGrid>
          {window ? (
            <p className="mt-2 text-caption text-tertiary">{window}</p>
          ) : null}
        </div>
      ) : null}

      {runs.length === 0 ? (
        <div className="mt-8">
          <EmptyState
            title="No runs yet"
            description="Connect a repository to a project and start a run. Everything it extracts, translates and opens appears here."
          />
        </div>
      ) : (
        <div className="mt-6">
          <RunsTable runs={rows} />
          {/*
            Said, rather than left to be inferred from a round number.
            The toolbar's count is the rows on this page; past fifty that is not
            the total, and a page that shows "50 runs" while holding more is
            making the reader's fifty-first run invisible without telling them.
            §8 asks for pagination at this point — see `listRunsForViewer` for
            why the honest sentence comes first and the machinery waits for a
            workspace that needs it.
          */}
          {truncated ? (
            <p className="mt-4 text-caption text-tertiary">
              Showing the 50 most recent runs. Older ones are not on this page.
            </p>
          ) : null}
        </div>
      )}
    </Page>
  );
}
