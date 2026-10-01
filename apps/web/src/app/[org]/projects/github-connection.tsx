import {
  authorizeUrl,
  installBlockers,
  installUrl,
  readOAuthConfig,
  signState,
} from '@/lib/github/install';
import { readServiceRoleKey } from '@/lib/supabase/admin';
import { Badge } from '@localize-infra/ui';

/**
 * Whether this workspace has its own GitHub installation, and how to get one.
 *
 * Three states, and the difference between them is the difference between a
 * product and a demo, so none of them is smoothed over:
 *
 *  - **connected** — the workspace installed the App itself. Its token reaches
 *    its own repositories and nothing else. This is the real thing.
 *  - **available** — nothing connected yet, and a customer can do it now.
 *  - **unavailable** — something the callback needs is missing: the OAuth
 *    client secret, without which it cannot prove that whoever completes it
 *    owns the installation it names, or the service-role key, without which it
 *    cannot record the link it verified. The button is absent rather than
 *    disabled, and what is missing is named, because a flow that stores an
 *    unverified installation id is an account takeover wearing a feature's
 *    clothes.
 */
export function GitHubConnection({
  organizationId,
  appSlug,
  appOrigin,
  connected,
}: {
  organizationId: string;
  appSlug: string | null;
  /** Origin of this deployment, so the redirect_uri matches what GitHub has. */
  appOrigin: string;
  connected: {
    account_login: string;
    account_type: string;
    connected_at: string;
  } | null;
}) {
  const oauth = readOAuthConfig();
  const state = signState(organizationId);
  const canInstall = Boolean(oauth && appSlug && state && readServiceRoleKey());

  /*
   * The button authorizes; it does not install.
   *
   * It used to point at `installations/new`, which is a different thing wearing
   * the same name. For an account that already has the App, GitHub does not run
   * an install there — it redirects to the existing installation's settings
   * page, the callback is never reached, and the workspace stays unconnected
   * with no error to show for it. That is what the owner hit, and every
   * workspace after the first on a given account would have hit it too.
   *
   * Authorizing works whether or not the App is installed. Which installation
   * to link is discovered afterwards from the user's own token, in the
   * callback.
   */
  const connectHref =
    oauth && state
      ? authorizeUrl(oauth.clientId, state, `${appOrigin}/github/callback`)
      : null;
  const blockers = canInstall ? [] : installBlockers();

  return (
    <section
      aria-labelledby="github"
      /* No top margin: this is now the first block inside a tab panel,
         which brings its own `pt-4`. The margin was spacing from the block
         that used to sit above it on the page. */
      className="rounded-lg border border-line bg-surface/40 px-5 py-5"
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-2">
        <h2 id="github" className="text-subtitle font-semibold text-primary">
          GitHub
        </h2>
        {connected ? (
          <Badge tone="confident">Connected</Badge>
        ) : (
          <Badge tone="neutral">Not connected</Badge>
        )}
      </div>

      {connected ? (
        <p className="mt-3 text-small leading-6 text-secondary">
          Installed on{' '}
          <span className="font-mono text-primary">
            {connected.account_login}
          </span>{' '}
          ({connected.account_type === 'Organization' ? 'organisation' : 'user'}
          ). This workspace reads only the repositories that installation was
          granted.
        </p>
      ) : canInstall && connectHref ? (
        <>
          <p className="mt-3 max-w-[64ch] text-small leading-6 text-secondary">
            Authorise Localize Infra, and it will connect the installation you
            already have. You choose which repositories the app may read on
            GitHub, you can change or revoke that at any time, and nothing here
            can widen it.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <a
              href={connectHref}
              className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-body font-medium text-inverse transition-colors hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            >
              Connect GitHub
            </a>
            {/*
              The door for the one case authorising cannot solve: authorised,
              but the app is installed nowhere this person can reach. The
              callback reports that as `no-installation`, and a message with no
              way to act on it is the mistake this panel has already made once.
            */}
            {appSlug && state ? (
              <a
                href={installUrl(appSlug, state)}
                className="text-small text-secondary underline underline-offset-2 hover:text-primary"
              >
                Not installed yet? Install it on GitHub
              </a>
            ) : null}
          </div>
        </>
      ) : (
        <p className="mt-3 max-w-[64ch] text-small leading-6 text-secondary">
          Connecting your own GitHub account is not available on this
          deployment: it is missing what the callback needs to verify an
          installation and record it, so rather than store an installation id it
          cannot verify, the flow is switched off.
          {/*
            The variables, named. This used to end with "The CLI still works
            against a local clone", which was the only exit offered and is not
            a door — `packages/cli` is not published, so a developer outside
            this repository cannot take it. Naming what is missing is the one
            thing a reader can act on, and matches how the Closer surfaces
            report an absent model key.
          */}
          {blockers.length > 0 ? (
            <>
              {' '}
              Missing:{' '}
              {blockers.map((name, index) => (
                <span key={name}>
                  {index > 0 ? ', ' : ''}
                  <span className="font-mono text-primary">{name}</span>
                </span>
              ))}
              .
            </>
          ) : null}
        </p>
      )}
    </section>
  );
}
