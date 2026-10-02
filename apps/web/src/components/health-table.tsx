'use client';

import { DataFilter, DataSearch, DataToolbar } from '@/components/data-toolbar';
import { useTableQuery } from '@/lib/use-table-query';
import {
  EmptyState,
  SortableTH,
  StatusDot,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
  TableEmpty,
  type Tone,
} from '@localize-infra/ui';
import { GitPullRequest } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';

/**
 * Every health check this workspace has, as a data surface.
 *
 * Deliberately the same component shape as `runs-table.tsx` — DESIGN.md §8:
 * one object, one geometry. Density and column count differ; the arrangement
 * does not, including the mobile records that replace the table below `md`
 * rather than hiding its columns.
 *
 * §8's completeness clause is why the toolbar is not optional: a count, a
 * search, a filter, sortable columns, URL-addressable state, and designed
 * empty states. `useTableQuery` gives the last one for free, so this surface
 * is linkable to a colleague on the day it ships.
 */

export interface HealthTableRow {
  id: string;
  repository: string;
  pullNumber: number;
  conclusion: 'success' | 'neutral' | 'failure' | 'skipped';
  findingCount: number;
  correctable: number;
  correctivePrNumber: number | null;
  correctivePrUrl: string | null;
  skipped: boolean;
  createdAt: string;
}

/**
 * The tone of a check, which is not the tone of its GitHub conclusion.
 *
 * GitHub has one `neutral` for both "found problems" and "could not look", and
 * DESIGN.md §6.3 separates them. A check that found something has a real,
 * present, degraded state. A check that read nothing has no state to report and
 * takes no colour — painting it amber would assert behaviour about a repository
 * nothing was read from, which is the exact failure the product sells against.
 */
export function checkState(row: {
  skipped: boolean;
  findingCount: number;
}): { tone: Tone; label: string } {
  if (row.skipped) return { tone: 'neutral', label: 'Not analysed' };
  if (row.findingCount === 0)
    return { tone: 'confident', label: 'No problems' };
  return {
    tone: 'degraded',
    label: `${row.findingCount} problem${row.findingCount === 1 ? '' : 's'}`,
  };
}

const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'problems', label: 'Problems' },
  { value: 'fixable', label: 'Fixable' },
  { value: 'clean', label: 'Clean' },
  { value: 'skipped', label: 'Not analysed' },
] as const;

type Filter = (typeof FILTERS)[number]['value'];
type SortKey = 'when' | 'problems';

export function HealthTable({
  checks,
  orgSlug,
}: {
  checks: readonly HealthTableRow[];
  orgSlug: string;
}) {
  const { filter, query, sort, desc, setFilter, setQuery, toggleSort, reset } =
    useTableQuery<Filter, SortKey>({
      filter: 'all',
      sort: 'when',
      desc: true,
    });

  const rows = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    const order = (row: HealthTableRow, index: number) =>
      sort === 'problems' ? row.findingCount : checks.length - index;

    const keep = (row: HealthTableRow) => {
      if (filter === 'problems') return row.findingCount > 0;
      if (filter === 'fixable') return row.correctable > 0;
      if (filter === 'clean') return !row.skipped && row.findingCount === 0;
      if (filter === 'skipped') return row.skipped;
      return true;
    };

    return checks
      .map((row, index) => ({ row, order: order(row, index) }))
      .filter(({ row }) => keep(row))
      .filter(
        ({ row }) =>
          !needle ||
          row.repository.toLowerCase().includes(needle) ||
          String(row.pullNumber).includes(needle),
      )
      .sort((a, b) => (desc ? b.order - a.order : a.order - b.order))
      .map(({ row }) => row);
  }, [checks, filter, query, sort, desc]);

  const direction = (key: SortKey) =>
    sort === key ? (desc ? 'desc' : 'asc') : null;

  const empty = (
    <EmptyState
      title="No checks match"
      description="No check matches this filter or search. Clear it to see the rest."
      action={
        <button
          type="button"
          onClick={reset}
          className="rounded-sm text-body text-link underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          Show all checks
        </button>
      }
    />
  );

  return (
    <>
      <DataToolbar count={rows.length} total={checks.length} noun="check">
        <DataFilter
          label="Filter checks by result"
          value={filter}
          options={FILTERS}
          onChange={setFilter}
        />
        <DataSearch
          value={query}
          onChange={setQuery}
          label="Search checks by repository or pull request"
          placeholder="acme/app, #12…"
        />
      </DataToolbar>

      {/* Below md: records, not a narrower table. Same rows, same links, same
          accessible names — only the arrangement changes. */}
      <ul className="mt-1 md:hidden">
        {rows.length === 0 ? (
          <li className="border-t border-subtle py-10">{empty}</li>
        ) : (
          rows.map((row) => {
            const state = checkState(row);
            return (
              <li
                key={row.id}
                className="group relative border-t border-subtle"
              >
                <div className="flex items-baseline justify-between gap-3 pt-3">
                  <StatusDot tone={state.tone}>{state.label}</StatusDot>
                  <span className="shrink-0 text-caption text-tertiary">
                    {new Date(row.createdAt).toISOString().slice(0, 10)}
                  </span>
                </div>

                <Link
                  href={`/${orgSlug}/health/${row.id}`}
                  aria-label={`Check on ${row.repository} pull request ${row.pullNumber}, ${state.label.toLowerCase()}`}
                  className="mt-1.5 block font-mono text-caption text-secondary after:absolute after:inset-0 group-hover:text-primary focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus"
                >
                  {row.repository} · #{row.pullNumber}
                </Link>

                <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-2 pb-3.5">
                  <Fact label="Fixable">
                    {row.findingCount === 0
                      ? '—'
                      : `${row.correctable} of ${row.findingCount}`}
                  </Fact>
                  <Fact label="Correction">
                    {row.correctivePrNumber ? (
                      <span className="inline-flex items-center gap-1.5">
                        <GitPullRequest
                          className="size-3.5 shrink-0 text-tertiary"
                          aria-hidden="true"
                        />
                        #{row.correctivePrNumber}
                      </span>
                    ) : (
                      <span className="text-tertiary">—</span>
                    )}
                  </Fact>
                </dl>
              </li>
            );
          })
        )}
      </ul>

      <Table className="mt-1 hidden md:table">
        <THead>
          <TR>
            <TH className="w-[8.5rem]">Result</TH>
            <TH>Repository</TH>
            <TH className="hidden lg:table-cell">Pull request</TH>
            <SortableTH
              label="Fixable"
              numeric
              direction={direction('problems')}
              onSort={() => toggleSort('problems')}
            />
            <TH className="hidden lg:table-cell">Correction</TH>
            <SortableTH
              label="Checked"
              direction={direction('when')}
              onSort={() => toggleSort('when')}
            />
          </TR>
        </THead>
        <TBody>
          {rows.length === 0 ? (
            <TableEmpty colSpan={6}>{empty}</TableEmpty>
          ) : (
            rows.map((row) => {
              const state = checkState(row);
              return (
                <TR key={row.id}>
                  <TD>
                    <StatusDot tone={state.tone}>{state.label}</StatusDot>
                  </TD>
                  <TD>
                    <Link
                      href={`/${orgSlug}/health/${row.id}`}
                      className="rounded-sm font-medium text-link underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                    >
                      {row.repository}
                    </Link>
                    {/* Relocated, not dropped (DESIGN.md §8). */}
                    <span className="ms-2 font-mono text-caption text-tertiary lg:hidden">
                      #{row.pullNumber}
                    </span>
                  </TD>
                  <TD className="hidden font-mono text-caption text-secondary lg:table-cell">
                    #{row.pullNumber}
                  </TD>
                  <TD numeric>
                    {row.findingCount === 0 ? (
                      <span className="text-tertiary">—</span>
                    ) : (
                      `${row.correctable} of ${row.findingCount}`
                    )}
                  </TD>
                  <TD className="hidden lg:table-cell">
                    {row.correctivePrUrl && row.correctivePrNumber ? (
                      <a
                        href={row.correctivePrUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 rounded-sm text-link underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                      >
                        <GitPullRequest
                          aria-hidden="true"
                          className="size-3.5"
                        />
                        #{row.correctivePrNumber}
                      </a>
                    ) : (
                      <span className="text-tertiary">—</span>
                    )}
                  </TD>
                  <TD className="whitespace-nowrap text-secondary">
                    {new Date(row.createdAt).toISOString().slice(0, 10)}
                  </TD>
                </TR>
              );
            })
          )}
        </TBody>
      </Table>
    </>
  );
}

function Fact({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-caption text-tertiary">{label}</dt>
      <dd className="mt-0.5 text-body text-secondary tabular-nums">
        {children}
      </dd>
    </div>
  );
}
