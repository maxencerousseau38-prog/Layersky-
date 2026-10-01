import { Metric, MetricGrid } from '@/components/metric';
import { Page, PageHeader, PageMeta } from '@/components/page';
import { RunsTable } from '@/components/runs-table';
import { findOrganization, requireSession } from '@/lib/data/workspace';
import { toRunTableRow } from '@/lib/runs/table-row';
import { loadUsage } from '@/lib/usage/load';
import { describeLastUsed } from '@/lib/usage/summary';
import { Alert, Badge, Card } from '@localize-infra/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

export const metadata: Metadata = { title: 'Usage' };

/**
 * What this workspace has spent against the ceiling that can refuse it.
 *
 * ## This is not a meter, and the distinction is load-bearing
 *
 * Invariant 3 forbids billing by word, character, key or reviewer, and the PRD
 * forbids metering them "not even as a displayed statistic". Nothing here is
 * billed, nothing accumulates into an invoice, and no figure on this page
 * changes what anybody pays — the plan is flat and `/[org]/billing` still says
 * no price exists.
 *
 * What these numbers *are* is the denominator of a refusal. The hosted API
 * stops a workspace at 5000 strings a day to kill runaway scripts, `/pricing`
 * names that ceiling in public, and until now a member could hit it with no way
 * to see where they stood. A limit somebody can hit and cannot see is the kind
 * of claim this repository does not leave standing.
 *
 * The migration that created these counters anticipated exactly this surface:
 * it granted `api_usage_daily` to members and `api_limits()` to `authenticated`
 * with the note "a workspace reading its own usage needs the denominator".
 *
 * ## It reads; it never recounts
 *
 * Every figure comes from `api_usage_daily`, the row `consume_api_quota` writes
 * as it charges. Nothing is re-derived from `runs` or `run_translations`: a
 * second tally would be free to disagree with the one the ceiling is enforced
 * against, and the disagreement would show up as a page promising budget the
 * API refuses.
 *
 * ## Colour
 *
 * DESIGN.md §6.3: colour reports the state of something that exists. Being
 * under the ceiling is not a state worth a colour — a bar shading from green to
 * red would be encoding a plan position, not a fact. Only *reaching* the
 * ceiling gets a tone, because at that point the refusal is real and present.
 */
export default async function UsagePage({
  params,
}: {
  params: Promise<{ org: string }>;
}) {
  await requireSession();
  const { org } = await params;

  const organization = await findOrganization(org);
  // A workspace that exists but is not yours must look like one that does not.
  if (!organization) notFound();

  const { summary, runs, tokens, limitsUnavailable } = await loadUsage(
    organization.id,
  );
  const { today, month, limits } = summary;

  const rows = runs.map(toRunTableRow);
  const usedTokens = tokens.filter((token) => token.last_used_at !== null);

  return (
    <Page>
      <PageHeader
        title="Usage"
        purpose="What this workspace has spent against the hosted API's daily ceiling. Nothing here is billed."
        meta={
          <>
            <PageMeta label="Workspace">{organization.name}</PageMeta>
            <PageMeta label="UTC day">{summary.todayDate}</PageMeta>
          </>
        }
      />

      {/*
       * Today is one panel; the month below is three loose tiles.
       *
       * They used to be the same shape — a full-width `dl` of unbounded
       * columns — so two periods that mean different things rendered
       * identically and only the heading told them apart. Worse, at 1440 the
       * two figures sat 530px from each other with nothing in between, which
       * is §4.5.2's dead zone on an application surface.
       *
       * The panel is what makes them a pair: these two numbers share a
       * denominator, a reset and a refusal, and the month's do not.
       */}
      <section aria-labelledby="today" className="mt-6">
        <h2 id="today" className="text-subtitle font-semibold text-primary">
          Today
        </h2>

        <Card className="mt-3 p-5">
          <p className="max-w-[64ch] text-small leading-6 text-secondary">
            The ceiling exists to stop a runaway script, not to charge you. It
            resets at 00:00 UTC, and it lifts on request.
          </p>

          {limitsUnavailable ? (
            /*
             * No denominator, so none is printed. Saying "0 of 0" would be a
             * fabricated ceiling, and inventing 5000 here would be a number
             * this page believes rather than one the database enforces.
             *
             * The test id is what makes `usage.spec.ts` mean something: it
             * asserts this element has count 0 on a healthy database, and
             * until now there was no element for it to fail to find — the
             * assertion passed by matching nothing, on every branch.
             */
            <Alert
              tone="neutral"
              data-testid="limits-unavailable"
              className="mt-4 max-w-[64ch] bg-surface/40 px-4 py-3 leading-6"
            >
              The hosted API's limits could not be read, so this page will not
              claim what they are. The figures below are still this workspace's
              real spending.
            </Alert>
          ) : null}

          {/*
            Bounded to a measure, not stretched to the panel.

            The panel alone did not fix what was wrong here: the two figures
            still sat 530px apart at 1440, because a two-column grid across
            1136px puts the second column at x=858. Two numbers that share a
            reset, a denominator and a refusal have to read as a pair, and at
            half a metre apart they read as two unrelated facts.
          */}
          <dl
            // `@md/main`, not `sm:` — these two figures share a panel inside
            // the content column, and at a 768 viewport that column is 512px
            // wide, not 768. The viewport step put them side by side at a
            // width the column did not have.
            className="mt-5 grid max-w-2xl gap-x-10 gap-y-5 @md/main:grid-cols-2"
            data-testid="today-totals"
          >
            <div data-testid="today-strings">
              <dt className="text-caption text-tertiary">Strings translated</dt>
              <dd className="mt-1.5 flex flex-wrap items-baseline gap-2">
                <span className="font-mono text-title tabular-nums text-primary">
                  {today.strings.toLocaleString('en-US')}
                </span>
                {limitsUnavailable ? null : (
                  <span className="font-mono text-body tabular-nums text-tertiary">
                    of {limits.strings_per_day.toLocaleString('en-US')}
                  </span>
                )}
                {summary.atStringCeiling ? (
                  <Badge tone="degraded">Ceiling reached</Badge>
                ) : null}
              </dd>
            </div>

            <div data-testid="today-prs">
              <dt className="text-caption text-tertiary">
                Pull requests opened
              </dt>
              <dd className="mt-1.5 flex flex-wrap items-baseline gap-2">
                <span className="font-mono text-title tabular-nums text-primary">
                  {today.pullRequests.toLocaleString('en-US')}
                </span>
                {limitsUnavailable ? null : (
                  <span className="font-mono text-body tabular-nums text-tertiary">
                    of {limits.prs_per_day.toLocaleString('en-US')}
                  </span>
                )}
                {summary.atPullRequestCeiling ? (
                  <Badge tone="degraded">Ceiling reached</Badge>
                ) : null}
              </dd>
            </div>
          </dl>
        </Card>
      </section>

      <section aria-labelledby="month" className="mt-8">
        <h2 id="month" className="text-subtitle font-semibold text-primary">
          This month
        </h2>
        <p className="mt-1 max-w-[64ch] text-small leading-6 text-secondary">
          No monthly ceiling exists — this is the total, for your own reference.
        </p>
        {/*
          Three tiles rather than the panel above, because there is no ceiling
          here to group them under. The shape carries that difference, so the
          two sections stop reading as the same block twice.

          No tile says "of" anything: a month has no denominator in this
          product, and printing one would be inventing the limit the page
          spends its opening paragraph refusing to invent.
        */}
        <MetricGrid
          label="This month's totals"
          columns={3}
          className="mt-3"
          data-testid="month-totals"
        >
          <Metric
            label="Strings translated"
            value={month.strings.toLocaleString('en-US')}
          />
          <Metric
            label="Pull requests opened"
            value={month.pullRequests.toLocaleString('en-US')}
          />
          {/*
            No note on any of the three, rather than one on the one that
            happened to have a sentence available. Writing the other two so
            the row would look even is how explanatory copy gets invented —
            these labels say what they count, and a month has no denominator
            in this product to qualify them against.
          */}
          <Metric label="Days with activity" value={month.activeDays} />
        </MetricGrid>
      </section>

      <section aria-labelledby="runs" className="mt-8">
        <h2 id="runs" className="text-subtitle font-semibold text-primary">
          Recent runs
        </h2>
        <p className="mt-1 max-w-[64ch] text-small leading-6 text-secondary">
          The last {rows.length === 0 ? 'few' : rows.length} in this workspace.{' '}
          <Link
            href="/runs"
            className="text-link underline underline-offset-2 hover:text-link-hover"
          >
            Every run
          </Link>
          .
        </p>
        {/*
          Framed here and not on /runs, and the asymmetry is the point.

          On /runs the table is the page, and the viewport already frames it —
          a border would be a rectangle drawn inside a rectangle. Here it is
          one of four things competing down a single column, and without an
          edge the toolbar reads as belonging to the paragraph above it rather
          than to the rows below.

          `rounded-lg`, the radius DESIGN.md §5.1 gives panels. `Table` puts
          itself in an `overflow-x-auto` wrapper, so the frame cannot be burst
          by a wide row.
        */}
        {/*
          The side padding starts at `sm`, and that is a fix rather than a
          preference.

          With `px-4` at every width the panel took 32px out of a 358px column
          at 390, and the toolbar inside it needs 356 — so the filter pushed the
          panel 16px wider than its own box, and the panel pushed the section.
          Measured: toolbar scrollWidth 356 against clientWidth 324. `/runs`
          shows the identical toolbar with no panel and does not overflow, which
          is what identified the padding as the cause rather than the toolbar.
        */}
        <div className="mt-3 rounded-lg border border-line pt-3 sm:px-4">
          {/*
            The same component /runs uses, not a second table of the same
            object (DESIGN.md §8). It brings its own filter, search and
            URL-addressable sort, so this surface is complete without
            reimplementing any of them.
          */}
          <RunsTable runs={rows} />
        </div>
      </section>

      <section aria-labelledby="tokens" className="mt-8">
        <h2 id="tokens" className="text-subtitle font-semibold text-primary">
          CLI tokens
        </h2>
        <p className="mt-1 max-w-[64ch] text-small leading-6 text-secondary">
          When each token last reached the API.{' '}
          <Link
            href={`/${org}/tokens`}
            className="text-link underline underline-offset-2 hover:text-link-hover"
          >
            Manage tokens
          </Link>
          .
        </p>

        {tokens.length === 0 ? (
          <p className="mt-3 text-small text-secondary">
            No tokens in this workspace yet.
          </p>
        ) : (
          /*
            A panel, for the same reason the run table above is one — and the
            row rules become `divide-y` so the last one is the panel's own
            edge instead of a second line 1px inside it.
          */
          <ul className="mt-3 divide-y divide-subtle rounded-lg border border-line">
            {tokens.map((token) => (
              <li
                key={token.id}
                className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3"
                data-testid="token-use"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-body text-primary">
                    {token.name}
                  </span>
                  <span className="mt-0.5 block font-mono text-caption text-tertiary">
                    {token.token_prefix}…
                  </span>
                </span>
                <span
                  className="font-mono text-caption text-secondary"
                  data-testid="token-last-used"
                >
                  {describeLastUsed(token.last_used_at)}
                </span>
                {token.revoked_at ? (
                  <Badge tone="neutral">Revoked</Badge>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        {tokens.length > 0 && usedTokens.length === 0 ? (
          <p className="mt-3 max-w-[64ch] text-caption leading-5 text-tertiary">
            None of them has been used yet. `last_used_at` is stamped the first
            time a token reaches the API, so this stays empty until one does.
          </p>
        ) : null}
      </section>
    </Page>
  );
}
