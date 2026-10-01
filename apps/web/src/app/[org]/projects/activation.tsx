import type { Funnel } from '@/lib/metrics/funnel';
import { formatDuration } from '@/lib/metrics/funnel';

const LABELS: Record<string, string> = {
  workspace_created: 'Workspace',
  github_connected: 'GitHub connected',
  repository_connected: 'Repository connected',
  run_started: 'Runs started',
  run_finished: 'Runs finished',
  awaiting_review: 'Awaiting your answer',
  pull_request_created: 'Pull requests opened',
};

/**
 * How far this workspace has got, and how long the first pull request took.
 *
 * The first pull request is the activation event, so it is the one figure shown
 * large. Everything else is the path to it, in order, with the count the
 * database actually holds.
 *
 * Nothing here is estimated. A step that has not happened shows zero and reads
 * as zero; a measurement nobody takes is named in `notMeasured` rather than
 * rendered as a confident number.
 */
export function Activation({ funnel }: { funnel: Funnel }) {
  const ttfpr = formatDuration(funnel.timeToFirstPullRequestMs);

  return (
    <section
      aria-labelledby="activation"
      className="mt-6 rounded-lg border border-line bg-surface/40 px-5 py-5"
    >
      <h2 id="activation" className="text-subtitle font-semibold text-primary">
        Activation
      </h2>

      {funnel.activated ? (
        <p className="mt-3 text-small leading-6 text-secondary">
          First pull request opened{' '}
          <span className="font-mono text-primary">{ttfpr}</span> after this
          workspace was created.
        </p>
      ) : (
        <p className="mt-3 max-w-[64ch] text-small leading-6 text-secondary">
          No pull request yet. Connect a repository and run a localization to
          open the first one — that is the moment Layersky has actually done
          something for you.
        </p>
      )}

      <dl className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
        {funnel.steps
          .filter((step) => step.step !== 'workspace_created')
          .map((step) => (
            <div key={step.step}>
              <dt className="text-caption text-tertiary">
                {LABELS[step.step] ?? step.step}
              </dt>
              <dd className="font-mono text-primary">{step.count}</dd>
            </div>
          ))}
      </dl>

      {/*
        Said out loud rather than rendered as a zero. A merge rate nobody
        measures is an unanswered question, and answering it with "0%" would be
        the kind of confident wrong number this repository has had to remove
        before.
      */}
      {funnel.notMeasured.length > 0 ? (
        <ul className="mt-4 space-y-1">
          {funnel.notMeasured.map((line) => (
            <li key={line} className="text-caption text-tertiary">
              Not measured — {line}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
