import { EXAMPLE_CYCLE } from '@/lib/constants';
import { Check, GitPullRequest, X } from 'lucide-react';

/**
 * The product, as it actually appeared on a pull request anybody can open.
 *
 * This replaces `RunArtifact`, which drew the legacy pipeline — detect,
 * extract, translate, escalate, pull request — against a run in a **private**
 * repository. Two things were wrong with keeping it in the page's strongest
 * position. It sold the pipeline a person starts by hand, which is no longer
 * what this product leads with; and its evidence could not be followed,
 * because the repository it names answers 404 to every visitor.
 *
 * Every string below is read from the GitHub check-run API on 2026-10-03 and
 * lives in `EXAMPLE_CYCLE`. The two commits are on pull request #13 of the
 * i18next fixture, which is public:
 *
 *   d73683d  neutral  "6 i18n problems"
 *   e910905  success  "No i18n problems found"
 *
 * Between them sits corrective pull request #17, opened by Layersky against
 * that same branch. Nothing here is a mockup, and nothing here is a
 * screenshot either — it is the check's own title and summary, rendered.
 */

/**
 * The three beats, in the order they happened.
 *
 * Deliberately not five. The legacy pipeline's five stages are the product's
 * visual language (DESIGN.md §1.4) and still describe a run on `/runs/[id]`,
 * which is why `PIPELINE_STAGES` is untouched — but this is a different
 * sequence and borrowing the rail would say the two are the same thing.
 */
const BEATS = [
  {
    id: 'check',
    label: 'The check',
    detail: 'On the commit, within seconds of the push. Nothing to remember.',
  },
  {
    id: 'correct',
    label: 'The safe fix',
    detail:
      'Only a key the source defines and a language that has none. Everything else stays a finding.',
  },
  {
    id: 'recheck',
    label: 'The re-check',
    detail:
      'Merging the correction updates the branch, which runs the same check again.',
  },
] as const;

function CheckCard({
  state,
  sha,
  title,
  summary,
}: {
  state: 'problems' | 'clear';
  sha: string;
  title: string;
  summary: string;
}) {
  const problems = state === 'problems';
  return (
    <figure className="overflow-hidden rounded-xl border border-line bg-canvas shadow-e2">
      <figcaption className="flex items-center gap-2.5 border-b border-subtle bg-surface/60 px-4 py-2.5">
        {problems ? (
          <X
            aria-hidden="true"
            strokeWidth={2.5}
            className="size-4 shrink-0 text-tertiary"
          />
        ) : (
          /*
           * Jade, and only here. DESIGN.md §6.3: colour reports the state of
           * something that exists. A check that passed is exactly that, and
           * the card above it — a check that found problems — takes no hue,
           * because `neutral` is not a failure and painting it amber would
           * claim a degradation the product deliberately does not assert.
           */
          <Check
            aria-hidden="true"
            strokeWidth={2.5}
            className="size-4 shrink-0 text-confident"
          />
        )}
        <span className="font-mono text-small text-secondary">
          {EXAMPLE_CYCLE.checkName}
        </span>
        <span className="ms-auto font-mono text-caption text-tertiary">
          {sha}
        </span>
      </figcaption>
      <div className="px-4 py-4">
        <p className="font-display text-subtitle font-semibold text-primary">
          {title}
        </p>
        <p className="mt-1 text-small leading-5 text-tertiary">{summary}</p>
      </div>
    </figure>
  );
}

export function CheckCycle() {
  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] lg:items-start lg:gap-12">
      <div>
        <p className="text-eyebrow font-medium uppercase text-inverse/60">
          One pull request, start to finish
        </p>
        <ol className="mt-5 space-y-5">
          {BEATS.map((beat, i) => (
            <li key={beat.id} className="flex gap-3">
              {/*
               * `/60`, not `/40`. axe measured three failing nodes here on
               * the first build: an ordinal at 40% of the inverse ink on this
               * band does not reach 4.5:1 in either theme. 60% is the floor
               * every other piece of text on a dark band in this codebase
               * already uses, and `aria-hidden` does not exempt it — a
               * sighted reader still has to read it.
               */}
              <span
                aria-hidden="true"
                className="mt-0.5 font-mono text-micro text-inverse/60"
              >
                {String(i + 1).padStart(2, '0')}
              </span>
              <span className="min-w-0">
                <span className="block text-body font-medium text-inverse">
                  {beat.label}
                </span>
                <span className="mt-1 block text-small leading-5 text-inverse/60">
                  {beat.detail}
                </span>
              </span>
            </li>
          ))}
        </ol>
      </div>

      {/* The two cards and, between them, the pull request that turned one
          into the other. Stacked at every width: these are two readings of the
          same check and the order is the argument, so they must not land
          side by side where a reader can take them for two checks. */}
      <div className="space-y-3">
        <CheckCard
          state="problems"
          sha={EXAMPLE_CYCLE.before.sha}
          title={EXAMPLE_CYCLE.before.title}
          summary={EXAMPLE_CYCLE.before.summary}
        />

        <div className="flex items-center gap-2.5 ps-1">
          <GitPullRequest
            aria-hidden="true"
            className="size-4 shrink-0 text-inverse/50"
          />
          <p className="text-small leading-5 text-inverse/70">
            Layersky opened{' '}
            <a
              href={EXAMPLE_CYCLE.correction.url}
              target="_blank"
              rel="noreferrer noopener"
              className="rounded-sm text-inverse underline underline-offset-2 decoration-inverse/40 hover:decoration-inverse focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            >
              #{EXAMPLE_CYCLE.correction.number}
            </a>{' '}
            against the same branch — the six translations, and nothing else.
          </p>
        </div>

        <CheckCard
          state="clear"
          sha={EXAMPLE_CYCLE.after.sha}
          title={EXAMPLE_CYCLE.after.title}
          summary={EXAMPLE_CYCLE.after.summary}
        />
      </div>
    </div>
  );
}
