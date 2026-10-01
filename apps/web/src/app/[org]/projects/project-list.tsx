'use client';

import { DataFilter, DataSearch, DataToolbar } from '@/components/data-toolbar';
import { READINESS, readiness } from '@/lib/projects/readiness';
import type { Project } from '@/lib/supabase/database.types';
import { useTableQuery } from '@/lib/use-table-query';
import { EmptyState, StateRule, StatusDot } from '@localize-infra/ui';
import Link from 'next/link';
import * as React from 'react';

/**
 * The workspace's projects, as the page's subject rather than its footnote.
 *
 * They were a list of bare rows at the bottom of the page, below a GitHub panel
 * and an activation funnel — three bordered surfaces at one weight, and the
 * thing the page is named after arriving last and lightest. §4.6 is about
 * vertical density, but the failure here is ordering: a reader scanning for
 * their projects read two panels of setup first, every visit, forever.
 *
 * ## The State Rule, on the list it was missing from
 *
 * §1.4 calls the 3px leading-edge rule the product's signature and says it goes
 * everywhere copy appears. This list had none. Each row now carries one,
 * coloured by whether the project can actually run — see `readiness`, which
 * derives it from columns the row already holds.
 *
 * The rule is decorative on its own, which is why the tone is also spelt out in
 * words beside it (§13, WCAG 1.4.1). `StatusDot` carries that pairing already,
 * so the row does not invent a second way to say the same thing.
 *
 * ## One line of metadata, not three floating spans
 *
 * The slug, the source locale and the target count were three separately
 * positioned elements, two of which disappeared at breakpoints. They are one
 * monospace line now: it scans in a single pass, it survives 390px, and the
 * repository — which was not shown at all, on a page about connecting
 * repositories — is in it.
 *
 * ## Why it acquired a toolbar
 *
 * §8 is explicit that a data surface is incomplete without a result count, a
 * filter or search affordance, and URL-addressable filter state — "a hard
 * requirement, not a nicety". This list had none of the three, and the cost was
 * measured rather than assumed: a workspace holding twelve projects rendered a
 * 996px stack with no way to find anything in it, ordered oldest-first, so the
 * two projects that could actually run sat above ten that could not.
 *
 * `useTableQuery` is the same hook the runs table uses, so the parameters mean
 * the same thing on both surfaces and a filtered list can be sent to a
 * colleague. The toolbar appears only when there is more than one project:
 * a filter over a single row is chrome, and §9 charges rent for chrome.
 */

const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'ready', label: 'Ready' },
  { value: 'no-languages', label: 'No languages' },
  { value: 'no-repository', label: 'Not connected' },
] as const;

type Filter = (typeof FILTERS)[number]['value'];

/** Everything a reader might type looking for one project. */
function haystack(project: Project): string {
  return [
    project.name,
    project.slug,
    project.repository_owner,
    project.repository_name,
    project.repository_branch,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

export function ProjectList({
  orgSlug,
  projects,
}: {
  orgSlug: string;
  projects: readonly Project[];
}) {
  const { filter, query, setFilter, setQuery, reset } = useTableQuery<
    Filter,
    'created'
  >({ filter: 'all', sort: 'created', desc: false });

  const rows = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    return projects.filter((project) => {
      if (filter !== 'all' && readiness(project) !== filter) return false;
      return needle === '' || haystack(project).includes(needle);
    });
  }, [projects, filter, query]);

  return (
    <div className="mt-4">
      {projects.length > 1 ? (
        <DataToolbar count={rows.length} total={projects.length} noun="project">
          <DataFilter
            label="Filter projects by readiness"
            value={filter}
            options={FILTERS}
            onChange={setFilter}
          />
          <DataSearch
            value={query}
            onChange={setQuery}
            label="Search projects by name or repository"
            placeholder="Demo, fixture-vite…"
          />
        </DataToolbar>
      ) : null}

      {rows.length === 0 ? (
        /*
         * Inside the list, with a way back, exactly as the runs table does it.
         * A filter that empties the screen and offers nothing is how a reader
         * concludes their projects are gone.
         */
        <div className="border-t border-subtle py-10">
          <EmptyState
            title="No projects match"
            description="No project matches this readiness or search. Clear it to see the rest."
            action={
              <button
                type="button"
                onClick={reset}
                className="rounded-sm text-body text-link underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
              >
                Show all projects
              </button>
            }
          />
        </div>
      ) : (
        <ul className="mt-2 flex flex-col gap-2">
          {rows.map((project) => (
            <ProjectRow key={project.id} orgSlug={orgSlug} project={project} />
          ))}
        </ul>
      )}
    </div>
  );
}

function ProjectRow({
  orgSlug,
  project,
}: {
  orgSlug: string;
  project: Project;
}) {
  const state = READINESS[readiness(project)];
  const targets = project.target_locales ?? [];
  const repository =
    project.repository_owner && project.repository_name
      ? `${project.repository_owner}/${project.repository_name}`
      : null;

  return (
    <li>
      <StateRule
        tone={state.tone}
        /*
         * `group` and `relative` on the rule itself so the whole row is
         * one click target with one focus stop — the pattern the runs
         * table already uses. `ps-4` comes from StateRule; the rest of
         * the padding is the row's own.
         */
        className="group relative rounded-e-md py-3.5 pe-3 transition-colors hover:bg-surface has-[a:focus-visible]:bg-surface"
      >
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <Link
            href={`/${orgSlug}/projects/${project.slug}`}
            className="min-w-0 text-subtitle font-semibold text-primary after:absolute after:inset-0 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus"
          >
            {project.name}
          </Link>
          <span className="shrink-0">
            <StatusDot tone={state.tone}>{state.label}</StatusDot>
          </span>
        </div>

        <p className="mt-1.5 truncate font-mono text-caption text-tertiary">
          {repository ?? project.slug}
          {/*
            The branch, which the row held and never showed. Which branch a
            pull request is opened against is not a detail on a surface whose
            output is a pull request — and it is the column that tells two
            projects on one repository apart.
          */}
          {repository && project.repository_branch ? (
            <>
              <span aria-hidden="true"> · </span>
              {project.repository_branch}
            </>
          ) : null}
          <span aria-hidden="true"> · </span>
          {project.source_locale}
          <span aria-hidden="true"> → </span>
          {targets.length > 0 ? (
            targets.join(', ')
          ) : (
            <span className="text-degraded-text">none</span>
          )}
        </p>

        {/*
          The next step, for the one state where the label does not already
          give it.
          ──────────────────────────────────────────────────────────────────
          `READINESS.detail` already existed and no surface rendered it, so the
          first version of this printed it under every row that was not ready.
          On the twelve-project workspace that put "Connect a repository to run
          it." on screen ten times — a sentence repeated until it stops being
          read, which is how a page teaches people to skip its warnings.

          `degraded` only. "Not connected" is its own instruction and is the
          *unfinished* state, which `readiness` deliberately leaves neutral;
          "No target languages" is the one that looks configured and silently
          refuses every run, and that is the reading worth spending a line on.
        */}
        {state.tone === 'degraded' ? (
          <p className="mt-1 text-caption text-secondary">{state.detail}</p>
        ) : null}
      </StateRule>
    </li>
  );
}
