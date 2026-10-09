import { Page, PageHeader, PageMeta, PageSection } from '@/components/page';
import { loadActivation } from '@/lib/closer/activation';
import { loadLeadDetail } from '@/lib/closer/pipeline';
import { requireSession } from '@/lib/data/workspace';
import { isSupabaseConfigured } from '@/lib/supabase/env';
import {
  ACTIVATION_MILESTONES,
  LOSS_REASON_LABELS,
  STAGE_LABELS,
  isTerminal,
  stageLabel,
  suggestedActivationStage,
} from '@localize-infra/closer-core';
import { Badge } from '@localize-infra/ui';
import { Check, ExternalLink, Minus } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { StageForm } from './stage-form';

export const metadata: Metadata = { title: 'Lead · Closer' };

/**
 * One lead, with everything that is known about it and nothing that is not.
 *
 * Six things the brief asked to be visible, each from its own source: the track
 * and stage from `closer_leads`; the activation milestones derived from
 * `organization_github_installations` and `i18n_checks`; the loss reason and
 * exit stage from the `closer_losses` view, which reads them off the one
 * history row that holds both; the transition history from
 * `closer_stage_history`; and the next action from the column that exists for
 * it, falling back to what can be derived rather than to an invented task.
 *
 * Authorisation is the layout's. This repeats the environment precondition
 * only, because Next renders a layout and its page concurrently and this would
 * otherwise start querying a database that is not configured.
 *
 * **No `loading.tsx` beside this file, and that is deliberate.** This route
 * 404s for a lead RLS does not return, and a loading file makes Next stream —
 * the shell goes out with a `200` already on the wire and the later
 * `notFound()` can change the body but not the status. That is the mistake
 * `components/page-skeleton.tsx` records paying for on `/[org]/usage`, caught
 * by a spec that asserted the status rather than the words. `/closer/companies`
 * is excluded for the same reason.
 */
export default async function CloserLeadPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (!isSupabaseConfigured()) notFound();

  const { id } = await params;
  const session = await requireSession();

  const result = await loadLeadDetail(id);

  /*
   * A lead that RLS does not return and a lead that does not exist are the
   * same 404 on purpose. Telling them apart would confirm the row exists to
   * somebody who cannot read it.
   */
  if (result.kind === 'missing') notFound();

  /*
   * A database failure is not a missing lead, and it used to be reported as
   * one. Saying "this lead does not exist" because a query timed out sends an
   * operator looking for a deletion that never happened.
   */
  if (result.kind === 'error') {
    return (
      <Page>
        <PageHeader title="Lead" purpose="This lead could not be read." />
        <PageSection title="Could not read this lead">
          <p role="alert" className="text-small text-failed-text">
            {result.message}
          </p>
          <p className="mt-2 text-caption text-tertiary">
            The lead has not been changed. This is a read that failed.
          </p>
        </PageSection>
      </Page>
    );
  }

  const { lead, contact, history, moves, lossReasons, loss } = result.detail;
  const activation = await loadActivation(lead.id, session.userId);

  const label = stageLabel(lead.track, lead.stage);
  const suggestion = suggestedActivationStage(lead.stage, activation.status);

  return (
    <Page>
      <PageHeader
        title={lead.company.name}
        purpose={label.meaning}
        meta={
          <>
            <PageMeta label="Track">
              {lead.track === 'design_partner' ? 'Design partner' : 'Sales'}
            </PageMeta>
            <PageMeta label="Stage">{label.label}</PageMeta>
          </>
        }
      />

      {/* ---- identity and repository ---- */}

      <PageSection
        title="Identity"
        description="What was discovered, and where it was read."
      >
        <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
          <div>
            <dt className="text-caption text-tertiary">Domain</dt>
            <dd className="font-mono text-small text-primary">
              {lead.company.domain ?? '—'}
            </dd>
          </div>
          <div>
            <dt className="text-caption text-tertiary">Repository</dt>
            <dd className="text-small">
              {lead.company.repository ? (
                lead.company.discoveredUrl ? (
                  <a
                    href={lead.company.discoveredUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="inline-flex items-center gap-1 font-mono text-secondary underline-offset-2 hover:underline"
                  >
                    {lead.company.repository}
                    <ExternalLink className="size-3" aria-hidden="true" />
                  </a>
                ) : (
                  <span className="font-mono text-primary">
                    {lead.company.repository}
                  </span>
                )
              ) : (
                <span className="text-tertiary">—</span>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-caption text-tertiary">Locales</dt>
            <dd className="font-mono text-small text-primary">
              {lead.company.locales.length > 0
                ? lead.company.locales.join(', ')
                : '—'}
            </dd>
          </div>
          <div>
            <dt className="text-caption text-tertiary">Contact</dt>
            <dd className="text-small text-primary">
              {contact
                ? [contact.fullName, contact.roleTitle]
                    .filter(Boolean)
                    .join(' · ') ||
                  contact.email ||
                  '—'
                : /*
                   * No contact is the normal state, not a missing field.
                   * `closer_leads.contact_id` is written by nothing in this
                   * repository — the fact that made the narrow suppression
                   * check unreachable — so saying "none chosen" is accurate
                   * where an em dash would read as data not yet loaded.
                   */
                  'None chosen'}
            </dd>
          </div>
        </dl>
      </PageSection>

      {/* ---- qualification: scores, and the evidence under them ---- */}

      <PageSection
        title="Qualification"
        description="Each score with the evidence it was computed from."
      >
        {lead.scores.length === 0 && lead.evidence.length === 0 ? (
          <p className="text-small text-secondary">
            Nothing has been researched yet. A score without its evidence is
            what this system is specified not to produce, so neither is shown.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap gap-3">
              {lead.scores.map((score) => (
                <span
                  key={score.kind}
                  className="font-mono text-small text-secondary"
                >
                  {score.kind === 'icp' ? 'fit' : score.kind} {score.value}
                  <span className="text-tertiary">
                    {' '}
                    ({Math.round(score.confidence * 100)}%)
                  </span>
                </span>
              ))}
            </div>
            {lead.evidence.length > 0 ? (
              <ul className="mt-3 space-y-1">
                {lead.evidence.map((item) => (
                  <li key={item.label} className="text-caption text-secondary">
                    <span className="font-mono text-tertiary">
                      {item.label}
                    </span>{' '}
                    — {item.summary}
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        )}
      </PageSection>

      {/* ---- activation ---- */}

      <PageSection
        title="Activation"
        description="Derived from the installation and the checks that ran, never stored."
      >
        {activation.unavailable ? (
          <p role="alert" className="text-small text-failed-text">
            {activation.unavailable}
          </p>
        ) : (
          <>
            {!activation.status.linked ? (
              <p className="text-small text-secondary">
                No workspace is linked to this lead yet, so none of the
                milestones can be read. That is the operator&rsquo;s
                bookkeeping, not the prospect&rsquo;s behaviour.
              </p>
            ) : null}
            <ul className="mt-2 space-y-1.5">
              {activation.status.milestones.map((verdict) => (
                <li
                  key={verdict.milestone}
                  className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5"
                >
                  {/*
                   * Colour reports a state that exists (DESIGN.md §6.3). A
                   * reached milestone has one; not reaching one is not a
                   * degraded state and gets no hue, and `not_derivable` is
                   * quieter still because nothing was measured.
                   */}
                  {verdict.state === 'reached' ? (
                    <Check
                      className="size-3.5 shrink-0 translate-y-0.5 text-confident-text"
                      aria-hidden="true"
                    />
                  ) : (
                    <Minus
                      className="size-3.5 shrink-0 translate-y-0.5 text-tertiary"
                      aria-hidden="true"
                    />
                  )}
                  <span className="text-small font-medium text-primary">
                    {STAGE_LABELS[verdict.milestone].label}
                  </span>
                  <span className="sr-only">
                    {verdict.state === 'reached'
                      ? 'reached'
                      : verdict.state === 'not_reached'
                        ? 'not reached'
                        : 'not derivable'}
                  </span>
                  <span
                    className={
                      verdict.state === 'not_derivable'
                        ? 'text-caption text-tertiary'
                        : 'text-caption text-secondary'
                    }
                  >
                    {verdict.why}
                  </span>
                </li>
              ))}
            </ul>
            {activation.status.derivedStage ? (
              <p className="mt-3 text-caption text-tertiary">
                The rows support{' '}
                <span className="font-medium text-secondary">
                  {STAGE_LABELS[activation.status.derivedStage].label}
                </span>
                {ACTIVATION_MILESTONES.length > 0 ? '.' : null}
              </p>
            ) : null}
          </>
        )}
      </PageSection>

      {/* ---- the loss, when there is one ---- */}

      {loss ? (
        <PageSection
          title="Lost"
          description="Where it left the funnel, and why — two separate facts."
        >
          <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
            <div>
              <dt className="text-caption text-tertiary">Exit stage</dt>
              <dd className="text-small text-primary">
                {stageLabel(lead.track, loss.exitStage).label}
              </dd>
            </div>
            <div>
              <dt className="text-caption text-tertiary">Loss reason</dt>
              <dd className="text-small text-primary">
                {LOSS_REASON_LABELS[loss.lossReason].label}
              </dd>
            </div>
          </dl>
          <p className="mt-2 text-caption text-secondary">
            {LOSS_REASON_LABELS[loss.lossReason].meaning}
          </p>
          <p className="mt-2 text-small text-secondary">{loss.note}</p>
        </PageSection>
      ) : null}

      {/* ---- next action ---- */}

      <PageSection title="Next" description="What to do, or honestly nothing.">
        {lead.nextAction ? (
          <p className="text-small text-primary">{lead.nextAction}</p>
        ) : suggestion ? (
          <p className="text-small text-primary">
            The product&rsquo;s own rows are ahead of this lead: move it to{' '}
            <span className="font-medium">
              {stageLabel(lead.track, suggestion).label}
            </span>
            . Nothing moves on its own — a funnel that advances itself is one
            whose numbers nobody can account for.
          </p>
        ) : isTerminal(lead.stage) ? (
          <p className="text-small text-secondary">
            This lead has stopped. {label.meaning}.
          </p>
        ) : (
          <p className="text-small text-secondary">
            Nothing is recorded against this lead, and nothing can be derived
            from its rows. &ldquo;Nothing, wait&rdquo; is a real answer, so no
            task is invented to fill the gap.
          </p>
        )}
      </PageSection>

      {/* ---- the move ---- */}

      <PageSection
        title="Move"
        description="Only the transitions the database will accept from here."
      >
        <StageForm
          leadId={lead.id}
          track={lead.track}
          moves={moves}
          lossReasons={lossReasons}
        />
      </PageSection>

      {/* ---- history ---- */}

      <PageSection
        title="History"
        description="Every stage change, newest first, with the reason given at the time."
      >
        {history.length === 0 ? (
          <p className="text-small text-secondary">
            No stage change has been recorded. The lead is where discovery
            opened it.
          </p>
        ) : (
          <ol className="space-y-2">
            {history.map((entry) => (
              <li
                key={entry.id}
                className="rounded-md border border-subtle px-3 py-2"
              >
                <div className="flex flex-wrap items-baseline gap-x-2">
                  {/*
                   * `stageLabel(track, …)`, not `STAGE_LABELS`.
                   *
                   * The two differ on exactly one stage —
                   * `ready_for_outreach` reads "Ready for review" on a
                   * design partner — and reading it raw here put both names
                   * for one stage on the same page: the Move list offered
                   * "Ready for review" and the history row it produced said
                   * "Ready for outreach". Found by the acceptance suite
                   * asserting that the destination it chose came back out.
                   */}
                  <span className="text-small text-primary">
                    {entry.fromStage
                      ? `${stageLabel(lead.track, entry.fromStage).label} → ${stageLabel(lead.track, entry.toStage).label}`
                      : stageLabel(lead.track, entry.toStage).label}
                  </span>
                  {entry.lossReason ? (
                    <Badge tone="neutral">
                      {LOSS_REASON_LABELS[entry.lossReason].label}
                    </Badge>
                  ) : null}
                  <time
                    dateTime={entry.createdAt}
                    className="font-mono text-caption text-tertiary"
                  >
                    {entry.createdAt.slice(0, 16).replace('T', ' ')}
                  </time>
                </div>
                <p className="mt-0.5 text-caption text-secondary">
                  {entry.reason}
                </p>
                {/*
                 * A null actor is an agent, and `reason` then says which one —
                 * the distinction `closer_stage_history` was shaped to keep.
                 */}
                {entry.actor === null ? (
                  <p className="text-caption text-tertiary">
                    Recorded by an agent.
                  </p>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </PageSection>

      <p className="px-4 pb-6 text-caption text-tertiary sm:px-6">
        <Link
          href="/closer/companies"
          className="underline-offset-2 hover:underline"
        >
          Back to the pipeline
        </Link>
      </p>
    </Page>
  );
}
