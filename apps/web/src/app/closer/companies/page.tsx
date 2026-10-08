import { Page, PageHeader, PageMeta, PageSection } from '@/components/page';
import { draftingModelConfigured } from '@/lib/closer/drafting';
import { loadPipeline, parseStage, parseTrack } from '@/lib/closer/pipeline';
import { isSupabaseConfigured } from '@/lib/supabase/env';
import { stageLabel } from '@localize-infra/closer-core';
import { Badge, EmptyState } from '@localize-infra/ui';
import { Building2, ExternalLink } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DiscoverForm } from './discover-form';
import { DraftButton } from './draft-button';
import { PipelineFilters } from './pipeline-filters';
import { ResearchButton } from './research-button';

export const metadata: Metadata = { title: 'Companies · Closer' };

/**
 * The pipeline: every lead, filterable by the motion it is on and the stage it
 * is at.
 *
 * ## Leads rather than companies, and the row kept its evidence
 *
 * A track and a stage belong to a lead, so this reads leads and embeds the
 * company — see `lib/closer/pipeline.ts` for why filtering an embedded
 * resource would have been wrong at the hundredth row. The evidence stays on
 * the row, because what justifies a row is the point of the row and a list of
 * names with scores beside them is the shape this system is specified not to
 * be.
 *
 * ## The data-surface contract
 *
 * DESIGN.md §8 wants a result count, a filter affordance, and designed empty,
 * loading and error states. The count is the number the filter matched rather
 * than the number on the page; the filter is a set of links, so a filtered
 * pipeline is a URL; there are two empty states because "nothing discovered"
 * and "nothing matches this filter" have different remedies; and the error is
 * the database's own message rather than a shrug.
 *
 * **No `loading.tsx`, and it is not an omission.** This route calls
 * `notFound()` when the deployment has no database, and a loading file makes
 * Next stream — the shell leaves with a `200` already on the wire and the
 * later `notFound()` can change the body but not the status.
 * `components/page-skeleton.tsx` records paying for exactly that on
 * `/[org]/usage`.
 */
export default async function CloserCompaniesPage({
  searchParams,
}: {
  searchParams: Promise<{ track?: string; stage?: string }>;
}) {
  if (!isSupabaseConfigured()) notFound();

  const { track: trackParam, stage: stageParam } = await searchParams;
  const track = parseTrack(trackParam);
  const stage = parseStage(stageParam);

  const { leads, total, error } = await loadPipeline({ track, stage });
  const draftingAvailable = draftingModelConfigured();
  const filtered = track !== null || stage !== null;

  return (
    <Page>
      <PageHeader
        title="Companies"
        purpose="Every lead discovery opened, with the evidence that qualified it."
        meta={
          <PageMeta label={filtered ? 'Matching' : 'Leads'}>{total}</PageMeta>
        }
      />

      <PageSection
        title="Discover"
        description="Search GitHub, then read each repository before recording it."
      >
        <DiscoverForm />
      </PageSection>

      <PageSection title="Leads" description="Most recently moved first.">
        <PipelineFilters track={track} stage={stage} />

        <div className="mt-4">
          {error ? (
            <p role="alert" className="text-small text-failed-text">
              Could not read the pipeline: {error}
            </p>
          ) : leads.length === 0 ? (
            /*
             * Two different empty states, because they have different
             * remedies. Nothing discovered at all is a prompt to discover;
             * nothing matching a filter is a prompt to widen it, and offering
             * "run a discovery" there would answer a question nobody asked.
             */
            filtered ? (
              <EmptyState
                icon={Building2}
                title="No lead matches this filter"
                description="Nothing sits on that track at that stage. Widen the filter, or clear it to see the whole pipeline."
              />
            ) : (
              <EmptyState
                icon={Building2}
                title="Nothing discovered yet"
                description="Run a discovery above. Nothing is recorded until its repository has been read and found to carry real localisation."
              />
            )
          ) : (
            <ul className="space-y-3">
              {leads.map((lead) => {
                const label = stageLabel(lead.track, lead.stage);
                return (
                  <li
                    key={lead.id}
                    className="rounded-lg border border-subtle px-4 py-3"
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                      <Link
                        href={`/closer/leads/${lead.id}`}
                        className="font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                      >
                        {lead.company.name}
                        {lead.company.domain ? (
                          <span className="ms-2 font-mono text-caption text-tertiary">
                            {lead.company.domain}
                          </span>
                        ) : null}
                      </Link>
                      <span className="flex flex-wrap items-center gap-2">
                        {['icp', 'pain'].map((kind) => {
                          const score = lead.scores.find(
                            (s) => s.kind === kind,
                          );
                          if (!score) return null;
                          return (
                            <span
                              key={kind}
                              className="font-mono text-caption text-secondary"
                            >
                              {kind === 'icp' ? 'fit' : 'pain'} {score.value}
                              <span className="text-tertiary">
                                {' '}
                                ({Math.round(score.confidence * 100)}%)
                              </span>
                            </span>
                          );
                        })}
                        {/*
                         * The track is named on the row because the two
                         * motions share their first eight stages — "Contacted"
                         * alone does not say which funnel a lead is in.
                         */}
                        <span className="text-caption text-tertiary">
                          {lead.track === 'design_partner'
                            ? 'Design partner'
                            : 'Sales'}
                        </span>
                        <Badge tone="neutral">{label.label}</Badge>
                      </span>
                    </div>

                    {lead.company.discoveredUrl ? (
                      <a
                        href={lead.company.discoveredUrl}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="mt-1 inline-flex items-center gap-1 font-mono text-caption text-secondary underline-offset-2 hover:underline"
                      >
                        {lead.company.repository}
                        <ExternalLink className="size-3" aria-hidden="true" />
                      </a>
                    ) : null}

                    {lead.company.locales.length > 0 ? (
                      <p className="mt-1 text-caption text-tertiary">
                        {lead.company.locales.length} locale(s):{' '}
                        <span className="font-mono">
                          {lead.company.locales.join(', ')}
                        </span>
                      </p>
                    ) : null}

                    {lead.evidence.length > 0 ? (
                      <ul className="mt-2 space-y-0.5">
                        {lead.evidence.map((item) => (
                          <li
                            key={`${lead.id}:${item.label}`}
                            className="text-caption text-secondary"
                          >
                            <span className="font-mono text-tertiary">
                              {item.label}
                            </span>{' '}
                            — {item.summary}
                          </li>
                        ))}
                      </ul>
                    ) : null}

                    <div className="mt-2 flex flex-wrap items-start gap-2">
                      {lead.company.repository ? (
                        <ResearchButton companyId={lead.company.id} />
                      ) : null}
                      {lead.evidence.length > 0 ? (
                        <DraftButton
                          leadId={lead.id}
                          enabled={draftingAvailable}
                        />
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </PageSection>
    </Page>
  );
}
