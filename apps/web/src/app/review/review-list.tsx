'use client';

import { DataFilter, DataSearch, DataToolbar } from '@/components/data-toolbar';
import type { ReviewItem } from '@/lib/data/workspace';
import { useUrlFilter } from '@/lib/use-table-query';
import {
  EmptyState,
  StateRule,
  cn,
  localeDisplayName,
  localeFontClass,
  localeTextProps,
} from '@localize-infra/ui';
import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';

/**
 * The wording a run is waiting on somebody to accept, grouped by the run.
 *
 * ## Every card used to be green
 *
 * The list painted `tone="confident"` on all of them, so the colour meant
 * "row". §6.2 allows colour to express the state of something that exists and
 * §6.3 forbids it as decoration; a palette where every item is the same colour
 * is the second thing wearing the clothes of the first.
 *
 * The right tone was available and unused. `listReviewItemsForViewer` selects
 * only from runs whose status is `awaiting_review` — every proposal on this
 * page is, by construction, a thing a person has to decide about. That is
 * §1.4's reserved meaning for Iris, stated exactly: *your judgement is
 * required*. This is the surface the reservation was made for.
 *
 * ## Grouped, because a flat list hid which run was asking
 *
 * The rows arrive from up to ten runs across every language, sorted by locale
 * and key, so two consecutive cards could belong to different runs and the only
 * clue was a small label. A reviewer deciding about a run needs to see that
 * run's proposals together, and needs the way to reach it.
 *
 * ## The proposal is the subject, the source is the context
 *
 * Source text was `text-body text-primary` and the proposed wording
 * `text-body text-secondary` — the thing being asked about rendered lighter
 * than the thing it replaces. They are two columns now, source muted on the
 * left and proposal in full weight on the right, which is also the shape of the
 * question: this becomes that.
 *
 * ## No approve button, and that is not an omission
 *
 * Approving a run commits its whole proposal, and it happens on the project
 * page beside the questions it depends on. There is no way to accept one key
 * and reject another, so a per-string control here would promise a granularity
 * the pipeline does not have. What this page can do is take the reader there,
 * which the run link does — replacing a sentence that told them to go.
 */
export function ReviewList({ items }: { items: readonly ReviewItem[] }) {
  /*
   * Filter and search in the URL (§9), through the same hook the proposals
   * table uses. A reviewer works by sending a colleague the exact thing they
   * are asking about; component state would make that a screenshot.
   */
  const [locale, setLocale] = useUrlFilter<string>('locale', 'all');
  const [query, setQuery] = useUrlFilter<string>('q', '');

  const locales = React.useMemo(
    () => [...new Set(items.map((i) => i.locale))].sort(),
    [items],
  );

  const matched = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    return items.filter(
      (item) =>
        (locale === 'all' || item.locale === locale) &&
        (!needle ||
          item.translation_key.toLowerCase().includes(needle) ||
          item.source_text.toLowerCase().includes(needle) ||
          item.proposed_text.toLowerCase().includes(needle)),
    );
  }, [items, locale, query]);

  /** Runs, in the order their first proposal appears, each with its own rows. */
  const groups = React.useMemo(() => {
    const byRun = new Map<string, ReviewItem[]>();
    for (const item of matched) {
      const existing = byRun.get(item.run_id);
      if (existing) existing.push(item);
      else byRun.set(item.run_id, [item]);
    }
    return [...byRun.entries()];
  }, [matched]);

  const reset = () => {
    setLocale('all');
    setQuery('');
  };

  return (
    <>
      <DataToolbar count={matched.length} total={items.length} noun="proposal">
        {/* Offered only when there is a choice to make. A filter whose every
            option returns everything is not a control — the same rule the
            proposals table applies to its origin filter. */}
        {locales.length > 1 ? (
          <DataFilter
            label="Filter proposals by language"
            value={locale}
            options={[
              { value: 'all', label: 'All languages' },
              ...locales.map((code) => ({
                value: code,
                label: localeDisplayName(code),
              })),
            ]}
            onChange={setLocale}
          />
        ) : null}
        <DataSearch
          value={query}
          onChange={setQuery}
          label="Search proposals by key, source or wording"
          placeholder="app.save, Enregistrer…"
        />
      </DataToolbar>

      {matched.length === 0 ? (
        <div className="mt-10">
          <EmptyState
            title="No proposal matches"
            description="No suggested wording matches this language or search. Clear it to see the rest."
            action={
              <button
                type="button"
                onClick={reset}
                className="rounded-sm text-body text-link underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
              >
                Show everything waiting
              </button>
            }
          />
        </div>
      ) : (
        <div className="mt-6 flex flex-col gap-8">
          {groups.map(([runId, rows]) => {
            const languages = [...new Set(rows.map((r) => r.locale))].sort();
            return (
              <section key={runId} aria-labelledby={`run-${runId}`}>
                <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 border-b border-subtle pb-3">
                  {/*
                   * `subtitle` 16/600, the step every other h2 in this
                   * application uses — not `small` 13/500.
                   *
                   * Measured across the dashboard: `/usage` and `/[org]/start`
                   * run their h2 at 16/600, this one ran at 13/500, and the
                   * proposal rows it groups are `body` 14. So the heading was
                   * a step *below* the content it headed, which is the
                   * hierarchy-contrast failure DESIGN.md §3.5 names and which
                   * this repository has already corrected twice on the site.
                   *
                   * The id keeps the monospace; the word does not. A run id is
                   * machine output (§8) and the label around it is prose.
                   */}
                  <h2
                    id={`run-${runId}`}
                    className="text-subtitle font-semibold text-primary"
                  >
                    Run <span className="font-mono">{runId.slice(0, 8)}</span>
                  </h2>
                  <p className="text-caption text-tertiary">
                    {rows.length} proposal{rows.length === 1 ? '' : 's'} ·{' '}
                    {languages
                      .map((code) => localeDisplayName(code))
                      .join(', ')}
                  </p>
                  {/*
                    Where the decision happens, as a way to get there.
                    It was a paragraph above the list telling the reader that
                    approving happens elsewhere — true, and not reachable. The
                    run page names the project and carries the questions that
                    have to be answered with it.
                  */}
                  <Link
                    href={`/runs/${runId}`}
                    className="inline-flex items-center gap-1.5 text-small text-link underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                  >
                    Open this run
                    <ArrowRight className="size-3.5" aria-hidden="true" />
                  </Link>
                </div>

                <ul className="flex flex-col divide-y divide-subtle">
                  {rows.map((item) => (
                    <li key={`${item.locale} ${item.translation_key}`}>
                      <StateRule
                        tone="ambiguous"
                        className="py-3.5 pe-3 transition-colors hover:bg-surface/60"
                      >
                        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                          <span className="min-w-0 truncate font-mono text-caption text-tertiary">
                            {item.translation_key}
                          </span>
                          <span className="font-mono text-micro uppercase tracking-wide text-tertiary">
                            {localeDisplayName(item.locale)}
                          </span>
                        </div>

                        {/*
                          Two columns from `sm`: what it says now, and what the
                          run proposes it say. Below that they stack, in the
                          same order — §12 asks for relocation rather than a
                          shrunken desktop row.
                        */}
                        <div className="mt-2 grid max-w-[46rem] gap-x-8 gap-y-1.5 sm:grid-cols-2">
                          <p className="text-small leading-6 text-tertiary">
                            {item.source_text}
                          </p>
                          <p
                            {...localeTextProps(item.locale)}
                            className={cn(
                              'text-body leading-6 text-primary',
                              localeFontClass(item.locale),
                            )}
                          >
                            {item.proposed_text}
                          </p>
                        </div>
                      </StateRule>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}
