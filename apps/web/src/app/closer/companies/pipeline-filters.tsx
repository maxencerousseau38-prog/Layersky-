import {
  CLOSER_STAGES,
  type CloserStage,
  type CloserTrack,
  TERMINAL_STAGES,
  stageLabel,
  trackStages,
} from '@localize-infra/closer-core';
import { cn } from '@localize-infra/ui';
import Link from 'next/link';

/**
 * The filter, as links rather than as a control.
 *
 * No client component and no JavaScript: a filtered pipeline is a URL, so it
 * can be bookmarked, opened in a second tab and linked to from a note. The
 * repository's other filter — `/settings?section=` — is the same shape, and
 * the alternative would ship a state machine to re-render a list the server
 * already renders.
 *
 * Which stages exist on a track comes from `trackStages`, which reads the same
 * list `closer_track_stages` holds. Terminals are appended because they belong
 * to every track, which is the rule `onTrack` states and the database
 * generates its rows from.
 */

function chip(active: boolean) {
  return cn(
    'rounded-full border px-3 py-1 text-caption',
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
    active
      ? 'border-strong bg-raised font-medium text-primary'
      : 'border-subtle text-secondary hover:text-primary',
  );
}

function href(track: CloserTrack | null, stage: CloserStage | null) {
  const params = new URLSearchParams();
  if (track) params.set('track', track);
  if (stage) params.set('stage', stage);
  const query = params.toString();
  return query ? `/closer/companies?${query}` : '/closer/companies';
}

export function PipelineFilters({
  track,
  stage,
}: {
  track: CloserTrack | null;
  stage: CloserStage | null;
}) {
  /*
   * The stages offered follow the chosen track. With no track chosen the list
   * is every stage, because a stage filter that silently covered one motion
   * would report an empty pipeline for leads that are plainly there.
   */
  const stages: readonly CloserStage[] = track
    ? [...trackStages(track), ...TERMINAL_STAGES]
    : CLOSER_STAGES;

  /*
   * Changing the track drops a stage that the new track does not own. Keeping
   * it would produce a filter pair that can match nothing — `negotiation` on
   * the design-partner track — and an empty list the operator cannot explain.
   */
  const keptStage = (next: CloserTrack | null) => {
    if (!stage) return null;
    if (!next) return stage;
    const owned = [...trackStages(next), ...TERMINAL_STAGES];
    return owned.includes(stage) ? stage : null;
  };

  return (
    <div className="space-y-2">
      {/*
       * `fieldset`/`legend` rather than a div with `role="group"`, which the
       * linter rejects in favour of the semantic element. The legend also
       * earns its keep: the visible "Track" label had no programmatic
       * association with the links it labelled, so a screen reader read six
       * unexplained link names.
       */}
      <fieldset className="flex flex-wrap items-center gap-1.5 border-0 p-0">
        <legend className="float-start me-1 text-caption text-tertiary">
          Track
        </legend>
        <Link
          href={href(null, keptStage(null))}
          className={chip(track === null)}
        >
          All
        </Link>
        <Link
          href={href('design_partner', keptStage('design_partner'))}
          className={chip(track === 'design_partner')}
        >
          Design partner
        </Link>
        <Link
          href={href('sales', keptStage('sales'))}
          className={chip(track === 'sales')}
        >
          Sales
        </Link>
      </fieldset>

      <fieldset className="flex flex-wrap items-center gap-1.5 border-0 p-0">
        <legend className="float-start me-1 text-caption text-tertiary">
          Stage
        </legend>
        <Link href={href(track, null)} className={chip(stage === null)}>
          All
        </Link>
        {stages.map((option) => (
          <Link
            key={option}
            href={href(track, option)}
            className={chip(stage === option)}
          >
            {stageLabel(track ?? 'sales', option).label}
          </Link>
        ))}
      </fieldset>
    </div>
  );
}
