import { Page, PageHeader, PageSection } from '@/components/page';
import {
  CONNECTION_CONFIG,
  type ConfigEntry,
  DETECTED_FRAMEWORKS,
  PULL_REQUEST_CONFIG,
  TRANSLATION_CONFIG,
} from '@/lib/cli-config';
import { NotBuiltYet, cn } from '@localize-infra/ui';
import { Lock } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = { title: 'Settings' };

const TABS = [
  { id: 'configuration', label: 'Configuration' },
  { id: 'account', label: 'Account' },
  { id: 'danger', label: 'Danger zone' },
] as const;

type Tab = (typeof TABS)[number]['id'];

/**
 * Links, not ARIA tabs.
 *
 * These sections are URL-addressable, which makes them navigation rather than a
 * tab widget: they survive a reload, they can be linked to, and they need no
 * JavaScript. ARIA tabs would mean hand-rolling roving focus for no gain.
 */
function SectionNav({ active }: { active: Tab }) {
  return (
    <nav aria-label="Settings sections" className="border-b border-subtle">
      <ul className="flex items-center gap-1">
        {TABS.map((tab) => {
          const current = tab.id === active;
          return (
            <li key={tab.id}>
              <Link
                href={`/settings?section=${tab.id}`}
                aria-current={current ? 'page' : undefined}
                className={cn(
                  '-mb-px block border-b-2 px-3 py-2 text-body',
                  'transition-colors duration-(--duration-micro)',
                  'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus',
                  current
                    ? 'border-primary font-medium text-primary'
                    : 'border-transparent text-tertiary hover:text-secondary',
                )}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * A configuration value, read-only.
 *
 * Deliberately not a form control. Rendering an input here would invite an edit
 * that cannot be saved — the one thing this surface must not do. The value is
 * shown as data, and the way to change it is shown beside it.
 */
function ConfigRow({ entry }: { entry: ConfigEntry }) {
  return (
    <div className="grid gap-1 border-b border-subtle py-4 last:border-b-0 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)] sm:gap-6">
      <div className="min-w-0">
        <p className="text-body font-medium text-primary">{entry.name}</p>
        <p className="mt-0.5 font-mono text-caption text-tertiary">
          {entry.setWith}
        </p>
      </div>
      <div className="min-w-0">
        <p className="font-mono text-small text-secondary">{entry.value}</p>
        <p className="mt-1 max-w-[60ch] text-small leading-5 text-secondary">
          {entry.description}
        </p>
      </div>
    </div>
  );
}

function ConfigGroup({
  title,
  description,
  entries,
}: {
  title: string;
  description: string;
  entries: ConfigEntry[];
}) {
  return (
    <PageSection title={title} description={description}>
      <div className="rounded-lg border border-subtle px-4">
        {entries.map((entry) => (
          <ConfigRow key={entry.name} entry={entry} />
        ))}
      </div>
    </PageSection>
  );
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ section?: string }>;
}) {
  const { section } = await searchParams;
  const active: Tab = TABS.some((t) => t.id === section)
    ? (section as Tab)
    : 'configuration';

  return (
    <Page>
      <PageHeader
        title="Settings"
        purpose="What the CLI is configured to do, and how to change it. Everything here is read-only — configuration lives in flags and environment variables, not in this browser."
      />

      <div className="mt-6">
        <SectionNav active={active} />
      </div>

      {active === 'configuration' ? (
        <>
          <ConfigGroup
            title="Translation"
            description="What gets translated, into what, and where it lands."
            entries={TRANSLATION_CONFIG}
          />
          <ConfigGroup
            title="Connection"
            description="The API that performs translation. You run it yourself; there is no hosted instance."
            entries={CONNECTION_CONFIG}
          />
          <ConfigGroup
            title="Pull requests"
            description="How output reaches your repository."
            entries={PULL_REQUEST_CONFIG}
          />

          <PageSection
            title="Framework detection"
            description="Detected automatically from your package.json and config files. No match is a refusal, not a guess."
          >
            <ul className="grid gap-2 sm:grid-cols-3">
              {DETECTED_FRAMEWORKS.map((framework) => (
                <li
                  key={framework.name}
                  className="rounded-lg border border-subtle p-4"
                >
                  <p className="text-body font-medium text-primary">
                    {framework.name}
                  </p>
                  <p className="mt-1 text-small leading-5 text-secondary">
                    Detected by {framework.signal}.
                  </p>
                </li>
              ))}
            </ul>
          </PageSection>
        </>
      ) : null}

      {active === 'account' ? (
        <div className="mt-8">
          {/* No sample data here, unlike every other surface. The others show
              data, where a labelled sample demonstrates the shape honestly.
              This shows controls, and a control that silently fails to save is
              a worse lie than an empty section. */}
          {/*
           * **This said "There is no account, organisation or team to
           * configure", to readers who had all three.** Written before
           * authentication landed and never revisited: sign-up is open,
           * workspaces carry roles, and CLI tokens are managed on
           * `/[org]/tokens`. A signed-in customer reading that it has no
           * account is the cheapest credibility a product can lose.
           *
           * What is still absent is this *surface*, not the concepts — so the
           * sentence now says which screens do the work today and what has no
           * home yet.
           */}
          <NotBuiltYet
            surface="Account settings"
            blockedBy="Accounts, workspaces and roles exist — this screen does not. Members and roles are managed per workspace, CLI tokens on the workspace's Tokens page; changing your email or password, and notification preferences, have no surface yet."
            className="max-w-[65ch]"
          />
        </div>
      ) : null}

      {active === 'danger' ? (
        <div className="mt-8 max-w-[65ch]">
          {/*
           * **"needs both to exist first" was false in both halves.** Projects
           * and organisations exist, and deleting a project already ships — on
           * `/[org]/projects/[project]`, owner-or-admin, confirmed by typing
           * the slug. What has no surface is deleting a *workspace*, which
           * `/privacy` and `/dpa` now describe as done on request rather than
           * self-serve.
           *
           * No delete control is added here. A destructive button on a screen
           * whose action does not exist is the lie `NotBuiltYet` is for.
           */}
          <NotBuiltYet
            surface="The danger zone"
            blockedBy="Deleting a project already lives on the project's own page, where it names what the deletion takes with it. Deleting a whole workspace, or an account, has no surface yet and is done on request — see the privacy page. Your translations live in your repository either way; nothing here would ever delete them."
          />
          <div className="mt-4 flex items-start gap-3 rounded-lg border border-subtle bg-surface px-4 py-3">
            <Lock
              className="mt-0.5 size-4 shrink-0 text-tertiary"
              aria-hidden="true"
              strokeWidth={1.5}
            />
            <p className="text-small leading-5 text-secondary">
              When these exist, a destructive action will require typing the
              resource name and will state its consequence in plain language
              before it runs.
            </p>
          </div>
        </div>
      ) : null}
    </Page>
  );
}
