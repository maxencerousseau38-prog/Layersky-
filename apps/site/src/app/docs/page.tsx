import { Code, CodeBlock } from '@/components/docs/code-block';
import { DocsToc, type TocEntry } from '@/components/docs/toc';
import { PageHeader } from '@/components/page-header';
import {
  API_URL,
  APP_URL,
  CLI_PERSONAL_TOKENS_LIVE,
  CLI_PUBLISHED_TO_NPM,
  EXAMPLE_CYCLE,
  FIXTURE_REPO_URL,
  GITHUB_REPO_URL,
  INSTALL_COMMAND,
  SUPPORTED_I18N_LIBRARY,
} from '@/lib/constants';
import { Badge, StateRule } from '@localize-infra/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import type * as React from 'react';

export const metadata: Metadata = {
  title: 'Documentation',
  description:
    'Installing the GitHub App, what the i18n check reports on a pull request, which findings are corrected automatically, and the CLI for extracting hardcoded strings.',
  alternates: { canonical: '/docs' },
};

/*
 * The GitHub App first, the CLI second.
 *
 * This page documented one product — the CLI — under the title "Everything
 * the CLI does, and everything it does not", while the thing the product now
 * leads with had no entry at all. A reader who installed the App from the
 * landing page arrived here and found a page about something else.
 *
 * The CLI sections keep their ids. They are linked from the hero, the
 * conversion dialog and `docs/releasing.md`, and renaming them to tidy a
 * table of contents would break three live links to fix nothing.
 */
const TOC: TocEntry[] = [
  { id: 'github-app', label: 'The GitHub App' },
  { id: 'check', label: 'What the check reports' },
  { id: 'correction', label: 'What it fixes for you' },
  { id: 'check-limits', label: 'Limits of the check' },
  { id: 'status', label: 'The CLI: before you start' },
  { id: 'install', label: 'Running it today' },
  { id: 'pipeline', label: 'What init does' },
  { id: 'reference', label: 'Command reference' },
  { id: 'environment', label: 'Environment variables' },
  { id: 'frameworks', label: 'Framework detection' },
  { id: 'extraction', label: 'What gets extracted' },
  { id: 'merging', label: 'How files are merged' },
  { id: 'privacy', label: 'What leaves your machine' },
  { id: 'errors', label: 'When it refuses' },
];

function Section({
  id,
  title,
  children,
  badge,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
  badge?: React.ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="scroll-mt-24 pt-14 first:pt-0">
      <div className="flex flex-wrap items-center gap-3">
        <h2
          id={id}
          className="font-display text-headline font-semibold text-primary"
        >
          {title}
        </h2>
        {badge}
      </div>
      <div className="mt-3 max-w-[68ch] space-y-3 text-prose text-secondary">
        {children}
      </div>
    </section>
  );
}

const FLAGS: Array<{ flag: string; value?: string; detail: React.ReactNode }> =
  [
    {
      flag: 'directory',
      detail: (
        <>
          Positional. The project to scan. Defaults to the current working
          directory.
        </>
      ),
    },
    {
      flag: '--force',
      detail: (
        <>
          By default <Code>init</Code> refuses to rewrite{' '}
          <Code>locales/en.json</Code> if that would drop keys the current
          extraction no longer produces. <Code>--force</Code> proceeds and lets
          them be removed.
        </>
      ),
    },
    {
      flag: '--api-url',
      value: '<url>',
      detail: (
        <>
          Base URL of the API instance to translate against. Defaults to{' '}
          <Code>
            {CLI_PERSONAL_TOKENS_LIVE ? API_URL : 'http://localhost:8787'}
          </Code>
          . <Code>LOCALIZE_API_URL</Code> is read when the flag is absent; if
          both are set, the flag wins.
        </>
      ),
    },
    {
      flag: '--api-token',
      value: '<token>',
      detail: (
        <>
          Bearer token for the API. Prefer <Code>LOCALIZE_API_TOKEN</Code> — a
          token on the command line lands in your shell history and in{' '}
          <Code>ps</Code> output. If both are set, the flag wins.
        </>
      ),
    },
    {
      flag: '--locales',
      value: '<list>',
      detail: (
        <>
          Comma-separated target locales, e.g. <Code>de,ja,es</Code>. Defaults
          to <Code>de,ja,es,ar,pt-BR</Code>.
        </>
      ),
    },
    {
      flag: '--open-pr',
      detail: (
        <>
          Open a pull request with the updated locale files. Requires{' '}
          <Code>--owner</Code> and <Code>--repo</Code>, both validated before
          the translation step so a typo costs nothing.
        </>
      ),
    },
    {
      flag: '--owner',
      value: '<owner>',
      detail: <>GitHub user or organisation. Required with --open-pr.</>,
    },
    {
      flag: '--repo',
      value: '<repo>',
      detail: <>GitHub repository name. Required with --open-pr.</>,
    },
    {
      flag: '--base-branch',
      value: '<branch>',
      detail: (
        <>
          Base branch for the pull request. Defaults to <Code>main</Code>.
        </>
      ),
    },
  ];

const FRAMEWORKS = [
  {
    name: 'Next.js',
    signal: (
      <>
        a <Code>next</Code> dependency, or a <Code>next.config.js</Code>,{' '}
        <Code>.mjs</Code> or <Code>.ts</Code>
      </>
    ),
    globs: 'app/**, pages/**, components/**, src/** (.ts, .tsx)',
  },
  {
    name: 'Vite + React',
    signal: (
      <>
        a <Code>react</Code> dependency <em>and</em> either a <Code>vite</Code>{' '}
        dependency or a <Code>vite.config.*</Code>
      </>
    ),
    globs: 'src/** (.ts, .tsx)',
  },
  {
    name: 'React Native',
    signal: (
      <>
        a <Code>react-native</Code> dependency
      </>
    ),
    globs: 'App.tsx, App.ts, src/** (.ts, .tsx)',
  },
];

const REFUSALS = [
  {
    when: 'No framework detected',
    message:
      'No supported framework detected. Supported: Next.js, Vite + React, React Native.',
    fix: 'Run it against the directory holding the package.json, not the repository root of a monorepo.',
  },
  {
    when: 'Existing keys would be dropped',
    message:
      'Refusing to overwrite locales/en.json: N existing key(s) would be removed…',
    fix: 'Review the diff. If the removals are correct, re-run with --force.',
  },
  {
    when: 'No token configured',
    message:
      'No API token configured. Pass --api-token or set the LOCALIZE_API_TOKEN environment variable.',
    fix: 'Export LOCALIZE_API_TOKEN. This is checked before anything is written.',
  },
  {
    when: '--open-pr without a valid target',
    message: '--open-pr requires valid --owner and --repo values…',
    fix: 'Pass both. Checked before the translation step, so a typo does not cost a run.',
  },
  {
    when: 'Too many requests, or the daily ceiling',
    message:
      'Too many translation requests from this CLI token: the limit is 30 a minute… / This workspace has reached today’s translation ceiling of 5000 strings…',
    fix: 'The hosted API answers 429 with a Retry-After header. The ceiling resets at 00:00 UTC; ask us if you need more, or point --api-url at your own instance, which has no ceiling.',
  },
];

export default function DocsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Documentation"
        title="What it checks, what it fixes, and what it refuses"
        lede="Two ways in: a GitHub App that watches every pull request, and a CLI that extracts hardcoded strings from source. Both are documented here, with the limits we would rather you read than discover in a pull request."
      />

      <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-16">
        <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_13rem] lg:gap-16">
          <div className="min-w-0">
            <Section
              id="github-app"
              title="The GitHub App"
              badge={<Badge tone="neutral">Early access</Badge>}
            >
              <p>
                Three steps, in this order, and the hosted app walks you through
                them one at a time:
              </p>
              <ol className="mt-4 space-y-3">
                <li>
                  <strong className="font-medium text-primary">
                    Create a workspace
                  </strong>{' '}
                  at{' '}
                  <a
                    href={APP_URL}
                    className="rounded-sm text-link underline underline-offset-2 hover:text-link-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                  >
                    the hosted app
                  </a>
                  . An email address and a password; nothing else is asked for,
                  and nothing is charged.
                </li>
                <li>
                  <strong className="font-medium text-primary">
                    Connect GitHub.
                  </strong>{' '}
                  This installs the App and asks which repositories it may
                  reach. Layersky can read exactly those and nothing else —
                  changing the selection on GitHub changes what it sees,
                  immediately. Public and private repositories are both
                  self-serve.
                </li>
                <li>
                  <strong className="font-medium text-primary">
                    Open a pull request.
                  </strong>{' '}
                  The next one that touches a locale catalogue gets a check on
                  its commit. There is nothing to configure and no file to add
                  to your repository.
                </li>
              </ol>
              <p className="mt-4">
                Every check your workspace receives is listed under{' '}
                <em>Health</em> in the app, with the findings behind it.
              </p>
            </Section>

            <Section id="check" title="What the check reports">
              <p>
                A check run named <Code>{EXAMPLE_CYCLE.checkName}</Code> appears
                on the commit. Its conclusion is <strong>always neutral</strong>
                : it reports, it never fails, and it cannot block a merge even
                on a repository with required checks. That is a deliberate
                choice rather than a limitation to be fixed quietly — reddening
                a repository on the strength of an unvalidated hypothesis is how
                a check gets switched off in its first week.
              </p>
              <p className="mt-4">
                It answers only for the keys the pull request{' '}
                <strong>changed</strong> — added, edited or deleted — compared
                against the commit the branch was created from, in every locale
                whose file the pull request touches. It never reports the
                backlog of keys your repository has never translated. Four
                findings are possible:
              </p>
              <ul className="mt-4 space-y-2.5">
                <li>
                  <Code>missing-translation</Code> — the source defines a key
                  and a language has no value for it.
                </li>
                <li>
                  <Code>placeholder-mismatch</Code> — a translation drops or
                  renames a placeholder the source has.
                </li>
                <li>
                  <Code>icu-invalid</Code> — an ICU message does not parse.
                </li>
                <li>
                  <Code>missing-source</Code> — a language carries a key the
                  source locale does not.
                </li>
              </ul>
              <p className="mt-4">
                If the repository cannot be analysed at all, the check says so
                and stays neutral. It never reports “no problems found” about
                something it did not read.
              </p>
            </Section>

            <Section id="correction" title="What it fixes for you">
              <p>
                One case: <Code>missing-translation</Code>. Layersky translates
                the missing values and opens a second pull request{' '}
                <strong>against your branch</strong>, so merging it updates the
                branch and re-runs the same check. Nothing is pushed to your
                default branch and nothing is merged for you.
              </p>
              <p className="mt-4">
                The other three findings are never corrected. Which side of a
                placeholder mismatch is wrong is a judgement, a rewritten plural
                can be grammatical and wrong, and deleting a key that a language
                has and the source does not is the obvious fix and the
                destructive one.
              </p>
              <p className="mt-4">
                Three things happen before a translation is written. The
                workspace is charged against its daily ceiling <em>before</em>{' '}
                any model is called, so a correction that cannot be delivered is
                never bought. The corrected file is then re-audited by the same
                code that produced the findings, and a translation it still
                complains about is discarded rather than committed. And a
                translation the model was not confident about is never written
                at all — the question it asked goes on the check instead.
              </p>
              <p className="mt-4">
                The pull request body names every language that was asked for,
                every one that landed, and every one that did not, with the
                reason. A correction can be partial; it cannot be silent.
              </p>
              <p className="mt-4">
                One delivery corrects at most <strong>40</strong>{' '}
                string-language pairs. Beyond that it refuses with a sentence
                rather than starting work it will not finish.
              </p>
            </Section>

            <Section id="check-limits" title="Limits of the check">
              <StateRule tone="degraded">
                <p>
                  <strong className="font-medium text-primary">
                    {SUPPORTED_I18N_LIBRARY} only.
                  </strong>{' '}
                  next-intl and react-intl are detected and answered with “not
                  supported”, which is a different and more useful answer than
                  silence — but it is still not support.
                </p>
              </StateRule>
              <ul className="mt-4 space-y-2.5">
                <li>
                  Catalogues are looked for in <Code>public/locales</Code>,{' '}
                  <Code>locales</Code> and <Code>src/locales</Code>. Nowhere
                  else.
                </li>
                <li>
                  Corrections are only written under <Code>locales/</Code>. A
                  repository whose catalogues live elsewhere is{' '}
                  <strong>analysable but not correctable</strong>, and the check
                  says so rather than failing after the translations have been
                  paid for.
                </li>
                <li>
                  A custom <Code>keySeparator</Code> is not supported and would
                  produce false missing keys.
                </li>
                <li>
                  The check reads catalogues, not source. A key your code calls
                  that no catalogue defines is not what this finds.
                </li>
              </ul>
              <p className="mt-4">
                A worked example on a public repository: pull request{' '}
                <a
                  href={EXAMPLE_CYCLE.pull.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="rounded-sm text-link underline underline-offset-2 hover:text-link-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                >
                  #{EXAMPLE_CYCLE.pull.number}
                </a>{' '}
                of{' '}
                <a
                  href={FIXTURE_REPO_URL}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="rounded-sm text-link underline underline-offset-2 hover:text-link-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                >
                  our i18next fixture
                </a>{' '}
                — the check, the corrective pull request it produced, and the
                same check green afterwards.
              </p>
            </Section>

            <Section
              id="status"
              title="The CLI: before you start"
              badge={<Badge tone="neutral">Pre-alpha</Badge>}
            >
              <p>
                Everything below is a <strong>different tool</strong> from the
                check above. The CLI finds hardcoded strings in your source,
                translates them and opens one pull request; the check reads
                catalogues on a pull request somebody already opened. They share
                a translation API and nothing else, and either works without the
                other.
              </p>
              <StateRule tone="neutral">
                {CLI_PUBLISHED_TO_NPM && CLI_PERSONAL_TOKENS_LIVE ? (
                  <>
                    <p>
                      <strong className="font-medium text-primary">
                        The CLI runs against the hosted API with a personal
                        token.
                      </strong>{' '}
                      Create one in the{' '}
                      <a
                        href={APP_URL}
                        className="rounded-sm text-link underline underline-offset-2 hover:text-link-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                      >
                        hosted app
                      </a>
                      , under your workspace’s <em>CLI tokens</em>. It is shown
                      once, expires, and can be revoked on its own.
                    </p>
                    <p className="mt-3">
                      A token acts for one workspace. Pull requests are opened
                      only through that workspace’s own GitHub connection, and
                      private repositories only if the workspace is entitled to
                      them. Without a token the command stops on a{' '}
                      <Link
                        href="#errors"
                        className="rounded-sm text-link underline underline-offset-2 hover:text-link-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                      >
                        missing-token refusal
                      </Link>{' '}
                      before it writes anything.
                    </p>
                    <p className="mt-3">
                      Early access. Public and private repositories are both
                      self-serve; what bounds the CLI is the same thing that
                      bounds the check, your GitHub installation. There is no
                      billing. You can still run your own API instead — see
                      below.
                    </p>
                  </>
                ) : CLI_PUBLISHED_TO_NPM ? (
                  <>
                    <p>
                      <strong className="font-medium text-primary">
                        The CLI is on npm, and installing it is not the same as
                        being able to use it.
                      </strong>{' '}
                      <Code>{INSTALL_COMMAND}</Code> installs and runs. It will
                      not translate anything until you point it at an API you
                      run yourself.
                    </p>
                    <p className="mt-3">
                      The hosted API is not open to the public — every route on
                      it needs a bearer token only we hold — so the one you
                      point at is your own. Run the CLI without a token and it
                      stops on a{' '}
                      <Link
                        href="#errors"
                        className="rounded-sm text-link underline underline-offset-2 hover:text-link-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                      >
                        missing-token refusal
                      </Link>{' '}
                      before it writes anything. It has detected the framework
                      and extracted the strings by then, in memory, on your
                      machine.
                    </p>
                    <p className="mt-3">
                      So you still need this repository — not for the CLI any
                      more, but for the API.
                    </p>
                    <p className="mt-3">
                      The{' '}
                      <a
                        href={APP_URL}
                        className="rounded-sm text-link underline underline-offset-2 hover:text-link-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                      >
                        hosted app
                      </a>{' '}
                      is the other way in: it runs the same pipeline from a
                      browser against a repository you connect, with no API to
                      run. Early access, public and private repositories both
                      self-serve, and no billing.
                    </p>
                  </>
                ) : (
                  <>
                    <p>
                      <strong className="font-medium text-primary">
                        The CLI is not published to npm yet.
                      </strong>{' '}
                      You cannot <Code>npx</Code> it. Until it is published, the
                      only way to run it is from a clone of the repository,
                      which is what the next section describes.
                    </p>
                    <p className="mt-3">
                      It also needs a running API instance to translate against.
                      The hosted one is not open to the public, so you run it
                      yourself, with your own provider key.
                    </p>
                  </>
                )}
              </StateRule>
              <p>
                What does work today, end to end, is the pipeline itself:
                detection, extraction, translation, merge, and a real pull
                request opened through the same GitHub App the check uses.
              </p>
            </Section>

            <Section id="install" title="Running it today">
              {CLI_PERSONAL_TOKENS_LIVE ? (
                <>
                  <p>
                    Create a personal token in the hosted app, then run the CLI
                    in your project. No API to run, no repository to clone.
                  </p>
                  {/*
                    Both dialects, because one of them does not run.
                    ───────────────────────────────────────────────
                    This block offered `export` alone. `export` is not a
                    PowerShell command — it reports `The term 'export' is not
                    recognized` — and PowerShell is the default shell on
                    Windows. So the first command on the page that a Windows
                    reader copies is the one command that cannot work, on the
                    page whose entire job is telling people how to run this.

                    The product already fixed exactly this on /[org]/start
                    (`lib/onboarding/commands.ts`, with a test pinning the
                    PowerShell form). The docs page never followed — the same
                    drift this repository keeps recording, where a fix lands on
                    one surface and the other keeps shipping the defect.

                    Labels match the product's: "PowerShell" and "macOS /
                    Linux", so the two surfaces cannot be read as describing
                    different things.
                  */}
                  <CodeBlock showLabel label="macOS / Linux">
                    {`export LOCALIZE_API_TOKEN="lit_…"   # from your workspace's CLI tokens
npx @localize-infra/cli init ./my-app
npx @localize-infra/cli init ./my-app --open-pr --owner <owner> --repo <repo>`}
                  </CodeBlock>
                  <CodeBlock showLabel label="PowerShell">
                    {`$env:LOCALIZE_API_TOKEN = "lit_…"   # from your workspace's CLI tokens
npx @localize-infra/cli init ./my-app
npx @localize-infra/cli init ./my-app --open-pr --owner <owner> --repo <repo>`}
                  </CodeBlock>
                  <p>
                    <Code>init</Code> checks the token — and, with{' '}
                    <Code>--open-pr</Code>, that your workspace’s GitHub
                    connection can reach the repository and its base branch —
                    before it writes or translates anything. It exits non-zero
                    when no language could be translated or the pull request
                    could not be opened.
                  </p>
                  {/*
                    §3.5: a heading has to rank against its own body text.
                    ─────────────────────────────────────────────────────
                    The page carried three h3 treatments for one semantic
                    level — 14/500 here, 14/600 in the refusal list, 16/600 in
                    the detection and known-gap blocks — and the first two sat
                    *below* the 17px prose they introduce.

                    16/600 was the first attempt and it was still wrong for the
                    two h3s that head prose rather than a list: 16 < 17. This
                    page runs three body sizes (17px prose, 14px list items,
                    12px refusal messages), so the only single step that
                    outranks all of them is 20px. That also completes one
                    ladder — 40 → 24 → 20 → 17 → 14 → 12 — and h2 stays
                    distinct at four pixels' difference because it is set in
                    Archivo against this one's Inter: the two registers §3.3
                    defines, doing the separating that size alone would not.
                  */}
                  <h3 className="text-title font-semibold text-primary">
                    Or run your own API
                  </h3>
                </>
              ) : null}
              {CLI_PUBLISHED_TO_NPM ? (
                <>
                  <p>
                    Installing the CLI is one command. Running it is three,
                    because the translation step goes through an API and the
                    hosted one is not open to the public — so the repository is
                    still needed, for the API rather than for the CLI.
                  </p>
                  <CodeBlock label="Install the CLI">
                    {'npx @localize-infra/cli --help'}
                  </CodeBlock>
                  <p>
                    Then clone the repository, because the API lives in it. The
                    CLI itself no longer needs building; the API does.
                  </p>
                  <CodeBlock label="Clone, for the API">
                    {`git clone ${GITHUB_REPO_URL}.git
cd localize-infra
npm install`}
                  </CodeBlock>
                </>
              ) : (
                <>
                  <p>
                    Clone the repository and install dependencies. The CLI
                    resolves <Code>@localize-infra/core</Code> through its build
                    output, so core has to be built first — skipping this is the
                    single most common local failure.
                  </p>
                  <CodeBlock label="Clone and build">
                    {`git clone ${GITHUB_REPO_URL}.git
cd localize-infra
npm install
npm run build -w @localize-infra/core`}
                  </CodeBlock>
                </>
              )}
              <p>
                Start the API. It needs a bearer token of your choosing and a
                provider key; it refuses to boot without{' '}
                <Code>API_AUTH_TOKEN</Code>.
              </p>
              {/*
                One rule rather than a second copy of every block. The hosted
                path above is the one people copy, so it carries both dialects;
                this path already assumes you can clone a repository and run a
                dev server, and doubling three blocks to say one thing would
                cost more than it explains.
              */}
              <p className="mt-3">
                The remaining commands use the POSIX form. On PowerShell, write{' '}
                <Code>{'$env:NAME = "value"'}</Code> wherever they say{' '}
                <Code>{'export NAME="value"'}</Code>.
              </p>
              <CodeBlock label="Run the API">
                {`export API_AUTH_TOKEN="a-token-you-choose"
export ANTHROPIC_API_KEY="sk-ant-..."
npm run dev -w @localize-infra/api   # listens on :8787`}
              </CodeBlock>
              <p>Then run the CLI against your project.</p>
              <CodeBlock label="Run init">
                {CLI_PUBLISHED_TO_NPM
                  ? `export LOCALIZE_API_TOKEN="a-token-you-choose"   # same value
npx @localize-infra/cli init ../my-app --api-url http://localhost:8787`
                  : `export LOCALIZE_API_TOKEN="a-token-you-choose"   # same value
npm exec -w @localize-infra/cli -- tsx src/index.ts init ../my-app`}
              </CodeBlock>
              <p>
                Extraction-only is not a supported mode: <Code>init</Code>{' '}
                always continues to the translation step, so a token is required
                even to write <Code>locales/en.json</Code>.
              </p>
            </Section>

            <Section id="pipeline" title="What init does">
              <ol className="space-y-2">
                {[
                  'Detects the framework from package.json and config files.',
                  'Extracts hardcoded UI strings from your source with an AST walk.',
                  'Writes locales/en.json — the source-of-truth catalog.',
                  'Translates each string into every target locale and writes locales/<locale>.json.',
                  'Optionally opens a pull request with the result.',
                ].map((step, index) => (
                  <li key={step} className="flex gap-3">
                    <span
                      aria-hidden="true"
                      className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border border-subtle font-mono text-micro text-tertiary"
                    >
                      {index + 1}
                    </span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
              <p>
                Steps 4 and 5 go through the API. The CLI never calls an LLM or
                the GitHub API directly.
              </p>
              <p>
                A failure in one language does not abort the others. Each locale
                reports its own outcome, and a partial run still produces a pull
                request containing the languages that succeeded.
              </p>
              <p>
                A run that would change nothing opens nothing. If every file it
                produced is already on the base branch, the API answers{' '}
                <Code>409</Code>, no branch is created, and the CLI prints{' '}
                <Code>
                  No PR opened: every translation is already on the base branch.
                </Code>{' '}
                and exits successfully — an up-to-date repository is the outcome
                you ran it for.
              </p>
            </Section>

            <Section id="reference" title="Command reference">
              <CodeBlock label="Usage">
                {`localize-infra init [directory] [--force] [--api-url <url>]
                   [--api-token <token>] [--locales <list>]
                   [--open-pr] [--owner <owner>] [--repo <repo>]
                   [--base-branch <branch>]
localize-infra --help | --version`}
              </CodeBlock>
              <p>
                <Code>init</Code> is the only command. <Code>--help</Code> or{' '}
                <Code>-h</Code>, and <Code>--version</Code> or <Code>-v</Code>,
                print and exit successfully — anywhere on the line, so{' '}
                <Code>init --help</Code> prints help instead of starting a run.
                Anything else prints usage and exits non-zero.
              </p>
              <div className="mt-6 overflow-x-auto">
                <table className="w-full border-collapse">
                  <caption className="sr-only">
                    Flags accepted by the init command
                  </caption>
                  <thead>
                    <tr className="border-b border-line">
                      <th
                        scope="col"
                        className="py-2.5 pe-4 text-start text-caption font-medium uppercase tracking-wide text-tertiary"
                      >
                        Flag
                      </th>
                      <th
                        scope="col"
                        className="py-2.5 text-start text-caption font-medium uppercase tracking-wide text-tertiary"
                      >
                        Meaning
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {FLAGS.map((row) => (
                      <tr key={row.flag} className="border-b border-subtle">
                        <th
                          scope="row"
                          className="py-3 pe-4 text-start align-top font-mono text-small font-normal text-primary"
                        >
                          {row.flag}
                          {row.value ? (
                            <span className="text-tertiary"> {row.value}</span>
                          ) : null}
                        </th>
                        <td className="py-3 align-top text-body leading-6 text-secondary">
                          {row.detail}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>

            <Section id="environment" title="Environment variables">
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <caption className="sr-only">
                    Environment variables read by the CLI and the API
                  </caption>
                  <thead>
                    <tr className="border-b border-line">
                      <th
                        scope="col"
                        className="py-2.5 pe-4 text-start text-caption font-medium uppercase tracking-wide text-tertiary"
                      >
                        Variable
                      </th>
                      <th
                        scope="col"
                        className="py-2.5 pe-4 text-start text-caption font-medium uppercase tracking-wide text-tertiary"
                      >
                        Read by
                      </th>
                      <th
                        scope="col"
                        className="py-2.5 text-start text-caption font-medium uppercase tracking-wide text-tertiary"
                      >
                        Purpose
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      [
                        'LOCALIZE_API_URL',
                        'CLI',
                        'API base URL when --api-url is absent. An empty value counts as unset.',
                      ],
                      [
                        'LOCALIZE_API_TOKEN',
                        'CLI',
                        CLI_PERSONAL_TOKENS_LIVE
                          ? 'Your personal CLI token for the hosted API, or the token your own API accepts. Preferred over --api-token. An empty value counts as unset.'
                          : 'Bearer token sent to the API. Preferred over --api-token. An empty value counts as unset.',
                      ],
                      [
                        'API_AUTH_TOKEN',
                        'API',
                        'The token the API accepts. Required — it refuses to start without one.',
                      ],
                      [
                        'ANTHROPIC_API_KEY',
                        'API',
                        'Provider key used for translation. At least one provider key is required.',
                      ],
                      [
                        'OPENAI_API_KEY',
                        'API',
                        'Optional second provider. With both keys set, locales are split between them.',
                      ],
                      [
                        'PORT',
                        'API',
                        'Listen port. Defaults to 8787, which is what the CLI assumes.',
                      ],
                      [
                        'GITHUB_APP_ID',
                        'API',
                        'GitHub App identity, needed only for --open-pr.',
                      ],
                      [
                        'GITHUB_APP_INSTALLATION_ID',
                        'API',
                        'Installation the App acts through. --open-pr only.',
                      ],
                      [
                        'GITHUB_APP_PRIVATE_KEY',
                        'API',
                        'The App private key, inline. Wins over the path form. --open-pr only.',
                      ],
                      [
                        'GITHUB_APP_PRIVATE_KEY_PATH',
                        'API',
                        'Path to the App private key. --open-pr only.',
                      ],
                    ].map(([name, readBy, purpose]) => (
                      <tr key={name} className="border-b border-subtle">
                        <th
                          scope="row"
                          className="py-3 pe-4 text-start align-top font-mono text-small font-normal text-primary"
                        >
                          {name}
                        </th>
                        <td className="py-3 pe-4 align-top text-small text-tertiary">
                          {readBy}
                        </td>
                        <td className="py-3 align-top text-body leading-6 text-secondary">
                          {purpose}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>

            <Section id="frameworks" title="Framework detection">
              <p>
                Detection is by dependency and config file, in this order. The
                first match wins; no match is a refusal, not a guess.
              </p>
              <div className="mt-4 space-y-4">
                {FRAMEWORKS.map((framework) => (
                  <div
                    key={framework.name}
                    className="rounded-lg border border-line p-4"
                  >
                    <h3 className="text-title font-semibold text-primary">
                      {framework.name}
                    </h3>
                    <p className="mt-1.5 text-body leading-6 text-secondary">
                      Detected by {framework.signal}.
                    </p>
                    <p className="mt-1.5 font-mono text-caption leading-5 text-tertiary">
                      Scans: {framework.globs}
                    </p>
                  </div>
                ))}
              </div>
              <p>
                Locale files are written to <Code>locales/</Code> in every case.
              </p>
            </Section>

            <Section id="extraction" title="What gets extracted">
              <p>
                JSX text content, plus four attributes: <Code>placeholder</Code>
                , <Code>alt</Code>, <Code>title</Code> and{' '}
                <Code>aria-label</Code>. Strings already inside a{' '}
                <Code>t()</Code>, <Code>translate()</Code> or{' '}
                <Code>i18n()</Code> call are left alone.
              </p>
              <p>Filtered out as noise, not text:</p>
              <ul className="space-y-1.5">
                {[
                  'Purely numeric, currency or punctuation strings — 42, $9.99, 12%.',
                  'Bare HTML entities such as &nbsp;.',
                  'Single kebab-case or snake_case tokens, which are class names rather than prose. "Dashboard" and "Cancel" are kept.',
                  'Test, spec and story files, so fixture text never reaches your catalog.',
                ].map((item) => (
                  <li
                    key={item}
                    className="before:me-2 before:text-tertiary before:content-['—']"
                  >
                    {item}
                  </li>
                ))}
              </ul>

              <StateRule tone="degraded" className="mt-6">
                <h3 className="text-title font-semibold text-primary">
                  Known gap: elements containing expressions
                </h3>
                <p className="mt-2">
                  <Code>{'<p>You have {count} messages</p>'}</Code> is extracted
                  as two fragments around the expression, not as one
                  placeholder-aware string. Translated independently, those
                  fragments produce wrong word order in languages that reorder
                  the sentence.
                </p>
                <p className="mt-2">
                  Fixing it means grouping an element&rsquo;s children into a
                  single ICU-aware string, which is a redesign of the extraction
                  model rather than a patch. It is not done, and it is listed
                  here because you will hit it.
                </p>
              </StateRule>

              <p className="mt-6">
                Strings inside JSX expressions — ternaries, template literals,{' '}
                <Code>{'{someVar}'}</Code> — are not extracted at all.
              </p>
            </Section>

            <Section id="merging" title="How files are merged">
              <p>
                A translation you edited by hand is never overwritten by a
                machine translation. On re-run, an existing non-English value is
                kept; only missing keys are filled in. For <Code>en.json</Code>{' '}
                the freshly extracted text always wins, because the source text
                is the source of truth.
              </p>
              {/*
                The half this section did not say, found by running the merge
                rather than by reading it.

                `mergeLocaleFile` builds its result from the freshly extracted
                catalogue, so a key that extraction does not produce is not
                carried over — it is dropped. `init` guards that, but only
                against `en.json`: `droppedKeys` is computed from the English
                file alone. A key you added by hand to `fr.json` that has no
                English counterpart is outside the guard.

                Probed against the published package, not inferred:
                  fr.json  {"app.save":"Enregistrer","app.handAdded":"…"}
                  merged   {"app.save":"Enregistrer"}

                It matters here more than it would elsewhere, because the
                section two above tells the reader that strings in template
                literals and JSX expressions are never extracted — so the two
                facts this page already states combine into a way to lose work,
                and the page stated neither half of the combination.
              */}
              <StateRule tone="degraded" className="mt-6 py-1">
                <p className="font-medium text-primary">
                  A key the extractor does not find is removed, not kept
                </p>
                <p className="mt-1">
                  The merge is rebuilt from what extraction produced, so a key
                  missing from it disappears from every locale file.{' '}
                  <Code>init</Code> refuses the run when that would drop keys
                  from <Code>en.json</Code> — but it only checks{' '}
                  <Code>en.json</Code>. A key you added by hand to{' '}
                  <Code>fr.json</Code> with no English counterpart is dropped
                  without a warning.
                </p>
                <p className="mt-2">
                  In practice this bites where the section above already warns:
                  a string inside a template literal is never extracted, so a
                  translation written for it by hand has nothing to survive on.
                  Keep hand-written entries in <Code>en.json</Code> too, where
                  the guard can see them.
                </p>
              </StateRule>
              <p>
                Keys are derived from the string and de-duplicated, so two
                identical strings in different files collapse into one entry.
                Output is written with sorted keys, which keeps diffs readable
                and review meaningful.
              </p>
            </Section>

            <Section
              id="privacy"
              title="What leaves your machine"
              badge={<Badge tone="degraded">Known gap</Badge>}
            >
              <StateRule tone="degraded">
                <p>
                  For every extracted string, the CLI sends its text,{' '}
                  <strong className="font-medium text-primary">
                    its file path, its component name and a snippet of the
                    surrounding source code
                  </strong>{' '}
                  to the API, which forwards them to a third-party model
                  provider.
                </p>
                <p className="mt-3">
                  That context is why translations are better — it is what
                  distinguishes &ldquo;Close&rdquo; the button from
                  &ldquo;Close&rdquo; the adjective — and it is also source code
                  leaving your machine to a provider that is not EU-hosted. EU
                  data residency is a stated goal of this project and is{' '}
                  <strong className="font-medium text-primary">
                    not implemented
                  </strong>
                  .
                </p>
                <p className="mt-3">
                  Do not run <Code>init</Code> over a tree containing code you
                  cannot send to a third party. See the{' '}
                  <Link
                    href="/security"
                    className="rounded-sm text-link underline underline-offset-2 hover:text-link-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                  >
                    security page
                  </Link>{' '}
                  for the full disclosure.
                </p>
              </StateRule>
            </Section>

            <Section id="errors" title="When it refuses">
              <p>
                <Code>init</Code> stops rather than guessing. Each refusal is
                checked before anything is written or billed.
              </p>
              <div className="mt-4 space-y-4">
                {REFUSALS.map((refusal) => (
                  <div
                    key={refusal.when}
                    className="rounded-lg border border-line p-4"
                  >
                    <h3 className="text-title font-semibold text-primary">
                      {refusal.when}
                    </h3>
                    <p className="mt-2 overflow-x-auto font-mono text-caption leading-5 text-failed-text">
                      {refusal.message}
                    </p>
                    <p className="mt-2 text-body leading-6 text-secondary">
                      {refusal.fix}
                    </p>
                  </div>
                ))}
              </div>
              <p className="mt-6">
                Full source for every behaviour on this page is in the{' '}
                <a
                  href={GITHUB_REPO_URL}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="rounded-sm text-link underline underline-offset-2 hover:text-link-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                >
                  repository
                </a>
                . If this page and the code disagree, the code is right and this
                page is a bug.
              </p>
            </Section>
          </div>

          <DocsToc entries={TOC} />
        </div>
      </div>
    </>
  );
}
