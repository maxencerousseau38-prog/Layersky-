import { Page, PageHeader, PageMeta } from '@/components/page';
import { findOrganization, requireSession } from '@/lib/data/workspace';
import { runCommand, translateOnlyCommand } from '@/lib/onboarding/commands';
import { loadOnboarding } from '@/lib/onboarding/load';
import type { OnboardingStep, StepId } from '@/lib/onboarding/steps';
import { REFUSALS } from '@/lib/onboarding/troubleshooting';
import { Alert, Badge, CopyCommand, type Tone } from '@localize-infra/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CreateToken } from '../tokens/create-token';
import { VerifyInstallation } from './verify-installation';

export const metadata: Metadata = { title: 'Get started' };

/**
 * The path from an empty workspace to a first pull request, in one place.
 *
 * Every piece of this already existed — connect GitHub on the projects page,
 * issue a token on the tokens page, run the CLI in a terminal — and that was
 * the problem: seven destinations and nothing saying which one is next. A
 * person who has never seen this product had to infer the order from the
 * navigation, and the order is not guessable (a token is useless before GitHub
 * is connected; `--open-pr` is refused before a repository is).
 *
 * ## It reports, it does not remember
 *
 * There is no onboarding table and no `completed_steps` column. Every status
 * here is derived from rows the product already writes, so the page cannot
 * disagree with the product — the failure mode of a stored checklist is
 * insisting you connect a repository you connected an hour ago, and it is not
 * available to this design.
 *
 * ## Only one step is open
 *
 * The current step is the only one carrying its controls. A checklist that
 * expands everything is a list of seven things to do; this is one thing to do
 * with six of them accounted for. DESIGN.md §8: name what is missing and offer
 * exactly one way to create it.
 */

/** The badge reports the state of the step, not its position in the list. */
function badge(step: OnboardingStep): { label: string; tone: Tone } {
  if (step.tone === 'failed') return { label: 'Failed', tone: 'failed' };
  // Iris, and only here: a run stopped to ask a question (DESIGN.md §1.4).
  if (step.tone === 'ambiguous')
    return { label: 'Needs you', tone: 'ambiguous' };
  if (step.status === 'done') return { label: 'Done', tone: 'confident' };
  if (step.status === 'current') return { label: 'Next', tone: 'neutral' };
  return { label: 'To do', tone: 'neutral' };
}

export default async function StartPage({
  params,
}: {
  params: Promise<{ org: string }>;
}) {
  await requireSession();
  const { org } = await params;

  const organization = await findOrganization(org);
  // A workspace that exists but is not yours must look like one that does not.
  if (!organization) notFound();

  const onboarding = await loadOnboarding(
    org,
    organization.id,
    organization.name,
  );

  const project = onboarding.commandProject;
  const target =
    project?.repositoryOwner && project.repositoryName
      ? {
          owner: project.repositoryOwner,
          repo: project.repositoryName,
          baseBranch: project.baseBranch,
        }
      : null;

  /*
   * The line the reader pastes, or null.
   *
   * `runCommand` refuses a target carrying anything a shell would interpret, so
   * this is null for a repository whose stored owner or branch is not a shape
   * it will emit. Rendering `?? ''` there would have put an empty copy button
   * on the page — a control that looks like the answer and does nothing, which
   * is worse than the sentence that replaces it.
   */
  const runLine = target
    ? (runCommand('posix', target) ?? translateOnlyCommand())
    : null;

  /** What the current step offers. Rendered for that step alone. */
  const body: Partial<Record<StepId, React.ReactNode>> = {
    github: (
      <>
        <p className="max-w-[64ch] text-small leading-6 text-secondary">
          Layersky opens pull requests through a GitHub App you install on your
          own account. You choose which repositories it may read.
        </p>
        <Link
          href={`/${org}/projects`}
          className="mt-3 inline-block text-link underline underline-offset-2 hover:text-link-hover"
        >
          Connect GitHub on the projects page
        </Link>
      </>
    ),
    repository: (
      <>
        <p className="max-w-[64ch] text-small leading-6 text-secondary">
          A project points at one repository and the languages it ships. Pick
          the repository from the ones your installation reaches — it is a list,
          not a text field, so a name you cannot reach cannot be entered.
        </p>
        <Link
          href={`/${org}/projects`}
          className="mt-3 inline-block text-link underline underline-offset-2 hover:text-link-hover"
        >
          Create a project
        </Link>
      </>
    ),
    token: (
      <>
        <p className="max-w-[64ch] text-small leading-6 text-secondary">
          The command-line tool authenticates with a token that belongs to you
          and acts only for this workspace. It is shown once.
        </p>
        <CreateToken orgSlug={org} target={target} />
      </>
    ),
    run: (
      <>
        <p className="max-w-[64ch] text-small leading-6 text-secondary">
          Run this in the root of your application — the directory with{' '}
          <span className="font-mono">package.json</span> — with{' '}
          <span className="font-mono">LOCALIZE_API_TOKEN</span> set to the token
          you copied.
        </p>
        <div className="mt-3">
          {runLine ? (
            <CopyCommand command={runLine} />
          ) : (
            <p className="text-small text-secondary">
              Connect a repository first — without one the CLI can translate but
              cannot open a pull request, which is the step after this.
            </p>
          )}
        </div>
        <p className="mt-2 max-w-[64ch] text-caption leading-5 text-tertiary">
          It checks the token, the repository and the branch <em>before</em>{' '}
          translating anything, so a mistake in any of them costs nothing.
        </p>
      </>
    ),
    pull_request: (
      <p className="max-w-[64ch] text-small leading-6 text-secondary">
        The run above opens it. When a string has more than one defensible
        reading the run stops and asks instead — that is the product working,
        and the question is waiting for you under Ambiguity.
      </p>
    ),
  };

  return (
    <Page>
      <PageHeader
        title="Get started"
        purpose="From an empty workspace to your first pull request."
        meta={
          <>
            <PageMeta label="Workspace">{organization.name}</PageMeta>
            <PageMeta label="Done">
              {onboarding.done} of {onboarding.total}
            </PageMeta>
          </>
        }
      />

      {onboarding.activated ? (
        <Alert
          tone="confident"
          className="mt-6 max-w-[64ch] px-4 py-3 leading-6"
        >
          This workspace has opened a pull request. The path below is done —
          everything after this is the same command, run again.
        </Alert>
      ) : null}

      <ol
        className="mt-6 border-t border-subtle"
        data-testid="onboarding-steps"
      >
        {onboarding.steps.map((step, index) => {
          const { label, tone } = badge(step);
          const open = step.status === 'current' || step.status === 'blocked';
          return (
            <li
              key={step.id}
              className="border-b border-subtle py-4"
              data-testid="onboarding-step"
              data-step={step.id}
              data-status={step.status}
            >
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <span className="font-mono text-caption text-tertiary">
                  {index + 1}
                </span>
                {/*
                 * The title no longer carries `min-w-0`, and the detail now
                 * does. Which of the two yields was backwards.
                 *
                 * `detail` is a repository path — one unbreakable 44-character
                 * token — and it had no way to shrink, while the title was the
                 * only flexible item *and* had its floor removed. The title
                 * therefore absorbed all of the shrinking: measured at a 768
                 * viewport it rendered 1px wide holding 68px of text, and step
                 * 3 read "Connect / a maxencerousseau38-prog/... / repository"
                 * with its own words broken around the path.
                 *
                 * Without `min-w-0` the title will not go below its longest
                 * word, which is what a step title should do; the path
                 * truncates instead, and the project page shows it in full.
                 */}
                <span className="flex-1 text-body font-medium text-primary">
                  {step.title}
                </span>
                {step.detail ? (
                  <span
                    className="min-w-0 truncate font-mono text-caption text-tertiary"
                    data-testid="step-detail"
                  >
                    {step.detail}
                  </span>
                ) : null}
                <Badge tone={tone}>{label}</Badge>
              </div>

              {step.problem ? (
                <p
                  className="mt-3 max-w-[64ch] text-small leading-6 text-secondary"
                  data-testid="step-problem"
                >
                  {step.problem}
                </p>
              ) : null}

              {open ? <div className="mt-3">{body[step.id]}</div> : null}

              {/*
                The verification sits under the GitHub step whenever it is
                connected, including once the step is done — "connected" is a
                row in a table, and the row outlives an uninstall on GitHub's
                side with nothing here to notice.
              */}
              {step.id === 'github' && step.status === 'done' ? (
                <VerifyInstallation orgSlug={org} />
              ) : null}
            </li>
          );
        })}
      </ol>

      <section aria-labelledby="stuck" className="mt-10">
        <h2 id="stuck" className="text-subtitle font-semibold text-primary">
          If a run is refused
        </h2>
        <p className="mt-2 max-w-[64ch] text-small leading-6 text-secondary">
          The CLI prints whatever the API said, verbatim. This is what each
          refusal means for you. None of them costs a translation: every one is
          decided before the model is called.
        </p>
        <dl className="mt-4 border-t border-subtle">
          {REFUSALS.map((refusal) => (
            <div
              key={`${refusal.status}-${refusal.situation}`}
              className="border-b border-subtle py-3"
              data-testid="refusal"
            >
              <dt className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-mono text-caption text-tertiary">
                  {refusal.status}
                </span>
                <span className="text-body font-medium text-primary">
                  {refusal.situation}
                </span>
              </dt>
              <dd className="mt-1 max-w-[72ch] text-small leading-6 text-secondary">
                {refusal.meaning}{' '}
                <span className="text-primary">{refusal.fix}</span>
                {refusal.href ? (
                  <>
                    {' '}
                    <Link
                      href={`/${org}${refusal.href}`}
                      className="text-link underline underline-offset-2 hover:text-link-hover"
                    >
                      Go there
                    </Link>
                  </>
                ) : null}
              </dd>
            </div>
          ))}
        </dl>
      </section>
    </Page>
  );
}
