'use client';

import type { AvailableRepository } from '@/lib/github/repositories';
import {
  Alert,
  Badge,
  Button,
  Field,
  useFieldControl,
} from '@localize-infra/ui';
import type { ComponentProps } from 'react';
import { useActionState } from 'react';
import { type ConnectState, connectRepository } from './connect-actions';

const EMPTY: ConnectState = {};

/*
 * Native controls that claim the id their Field's label points at.
 *
 * `Field` renders `<label htmlFor={controlId}>` and expects the control to take
 * that id through `useFieldControl`, which also carries `aria-describedby` for
 * the help text and `aria-invalid`. The hook has to run *inside* the Field —
 * that is where the provider is — so a control cannot be a bare element in the
 * parent's JSX, it has to be its own component.
 *
 * The select below was a bare element, so its label pointed at an id nothing
 * had: clicking "Repository" focused nothing and a screen reader announced an
 * unlabelled combo box. The design system's own docstring says a caller cannot
 * forget this wiring; this caller forgot it.
 */
function FieldSelect(props: ComponentProps<'select'>) {
  return <select {...useFieldControl()} {...props} />;
}

function FieldInput(props: ComponentProps<'input'>) {
  return <input {...useFieldControl()} {...props} />;
}

export interface RepositorySectionProps {
  orgSlug: string;
  projectSlug: string;
  /** Null when nothing is connected yet. */
  connected: {
    owner: string;
    name: string;
    branch: string | null;
    /** Null means the repository root. */
    rootDir: string | null;
  } | null;
  /** Empty when GitHub is unconfigured, or the installation was granted none. */
  available: AvailableRepository[];
  /**
   * Why the repository list could not be read, when it could not.
   *
   * Null on the ordinary path. Non-null means GitHub was asked and refused,
   * and `available` is then empty for a reason that is not "no repositories
   * were granted" — a distinction this section used to be unable to draw,
   * because the page crashed before it could render at all.
   */
  unavailable: {
    problem: string;
    detail: string | null;
    reconnect: boolean;
  } | null;
  /** Whether this workspace has its own installation of the App. */
  hasInstallation: boolean;
  gitHubConfigured: boolean;
}

/**
 * The repository connection, and an honest account of who may use it.
 *
 * The banner is not a disclaimer bolted on — it is the most important thing on
 * the section. A workspace with no installation of its own cannot connect
 * anything, and it deserves to be told why and where to go rather than shown a
 * disabled button (DESIGN.md §11).
 *
 * That paragraph used to say the deployment had "one shared GitHub App
 * installation, so the feature genuinely is operator-only". Neither half has
 * been true since installations became per-organization; the operator
 * allow-list it referred to had no callers when it was deleted.
 */
export function RepositorySection({
  orgSlug,
  projectSlug,
  connected,
  available,
  unavailable,
  hasInstallation,
  gitHubConfigured,
}: RepositorySectionProps) {
  const [state, action, pending] = useActionState(
    connectRepository.bind(null, orgSlug, projectSlug),
    EMPTY,
  );

  return (
    <section
      aria-labelledby="repository"
      className="mt-8 rounded-lg border border-line bg-surface/40 px-5 py-6"
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-2">
        <h2
          id="repository"
          className="text-subtitle font-semibold text-primary"
        >
          Repository
        </h2>
        {connected ? (
          <Badge tone="confident">Connected</Badge>
        ) : (
          <Badge tone="neutral">Not connected</Badge>
        )}
      </div>

      {/*
       * GitHub was asked and refused. Said here rather than swallowed.
       *
       * `degraded` and not `failed`: what is connected still is, and the pull
       * request path may well still work — what is unknown is the list of
       * repositories this installation reaches. Colouring it as a failure
       * would assert something this page has not established (§6.3).
       *
       * `reconnect` decides whether a way out is offered at all. It is true
       * only when GitHub reported the installation as gone; a 401 is the
       * operator's credentials, a 429 is a rate limit, a 5xx is GitHub — none
       * is fixed by reconnecting, and offering the button there would send
       * somebody to redo work that was never broken.
       */}
      {unavailable ? (
        <Alert tone="degraded" size="section" className="mt-4">
          <p>{unavailable.problem}</p>
          {unavailable.detail ? (
            // Verbatim (DESIGN.md §8): a reader comparing this against their
            // own GitHub logs must see the same string.
            <p className="mt-2 font-mono text-caption text-tertiary">
              {unavailable.detail}
            </p>
          ) : null}
          {unavailable.reconnect ? (
            <p className="mt-3">
              <Button asChild variant="secondary" size="sm">
                <a href={`/${orgSlug}/projects`}>Reconnect GitHub</a>
              </Button>
            </p>
          ) : null}
        </Alert>
      ) : null}

      {connected ? (
        <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-3">
          <div>
            <dt className="text-eyebrow font-medium uppercase text-tertiary">
              Repository
            </dt>
            <dd className="mt-1 font-mono text-caption text-primary">
              {connected.owner}/{connected.name}
            </dd>
          </div>
          <div>
            <dt className="text-eyebrow font-medium uppercase text-tertiary">
              Base branch
            </dt>
            <dd className="mt-1 font-mono text-caption text-primary">
              {connected.branch ?? 'default'}
            </dd>
          </div>
          <div>
            <dt className="text-eyebrow font-medium uppercase text-tertiary">
              Subdirectory
            </dt>
            <dd className="mt-1 font-mono text-caption text-primary">
              {/* "Repository root" rather than an em dash or a blank: the
                  absence of a subdirectory is a real answer, and the one most
                  projects have. */}
              {connected.rootDir ?? 'Repository root'}
            </dd>
          </div>
        </dl>
      ) : null}

      {!gitHubConfigured ? (
        <p className="mt-4 max-w-[64ch] text-small leading-6 text-secondary">
          This deployment has no GitHub App configured, so a repository cannot
          be connected. The CLI still works against a local clone.
        </p>
      ) : !hasInstallation ? (
        /*
         * The honest boundary, and now a route forward rather than a dead end.
         * This used to say per-customer installation was not built; it is, so
         * the sentence points at it (DESIGN.md §11: no control that looks like
         * it would work if you tried harder).
         */
        <p className="mt-4 max-w-[64ch] text-small leading-6 text-secondary">
          This workspace has not installed the Localize GitHub App yet. Install
          it from the workspace’s projects page, choose which repositories it
          may see, and they will appear here.
        </p>
      ) : available.length === 0 ? (
        /*
         * Installed, but granted nothing. A distinct state: the account holds
         * an installation whose repository selection is empty, which reads as a
         * broken product unless it says what to do about it.
         */
        <p className="mt-4 max-w-[64ch] text-small leading-6 text-secondary">
          Your installation is connected but has access to no repositories.
          Grant it access to at least one on GitHub, then reload this page.
        </p>
      ) : (
        <form action={action} className="mt-4 flex flex-col gap-4">
          <p className="max-w-[64ch] text-small leading-6 text-secondary">
            The repositories your installation of the Localize App can reach.
            Change the selection on GitHub to add or remove one.
          </p>

          <Field label="Repository" required>
            {/* A native select, not the Radix one in packages/ui: this form
                posts to a Server Action, and a native control carries its value
                without JavaScript. The Radix Select renders a button and would
                need a hidden input to submit at all. */}
            <FieldSelect
              name="repository"
              required
              defaultValue={
                connected ? `${connected.owner}/${connected.name}` : ''
              }
              className="h-8 w-full rounded-md border border-line bg-canvas px-2 text-body text-primary focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus"
            >
              <option value="">Choose a repository…</option>
              {available.map((repo) => (
                <option key={repo.fullName} value={repo.fullName}>
                  {repo.fullName} ({repo.private ? 'private' : 'public'},{' '}
                  {repo.defaultBranch})
                </option>
              ))}
            </FieldSelect>
          </Field>

          <Field
            label="Subdirectory"
            help="Leave empty if the app is at the repository root. In a monorepo, the folder the app lives in — for example apps/web."
          >
            <FieldInput
              type="text"
              name="rootDir"
              defaultValue={connected?.rootDir ?? ''}
              placeholder="apps/web"
              autoComplete="off"
              spellCheck={false}
              className="h-8 w-full rounded-md border border-line bg-canvas px-2 font-mono text-body text-primary placeholder:text-tertiary focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus"
            />
          </Field>

          <output aria-live="polite" className="contents">
            {state.error ? <Alert tone="failed">{state.error}</Alert> : null}
          </output>

          <div>
            <Button type="submit" variant="primary" disabled={pending}>
              {pending
                ? 'Connecting…'
                : connected
                  ? 'Change repository'
                  : 'Connect repository'}
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
