/**
 * Single source of truth for external references used across the site.
 *
 * Every claim on this site must be verifiable today (see
 * docs/frontend/07-milestones.md, FE-1 risks).
 */
/*
 * The repository's current name, which is not the one this held.
 *
 * It pointed at `…/localize-infra`, the name before the rename to Layersky.
 * GitHub still redirects that, so every link worked and nothing failed — a
 * `curl` showed `301` and then `200`. Two reasons it was worth changing
 * anyway: the redirect is only kept while nobody else claims the old name,
 * and this constant is the **public contact channel** (`CONTACT_URL` below is
 * this plus `/issues`), so a dead redirect would take the one channel a
 * visitor can reach without an email address.
 *
 * Canonical form read from the API rather than typed: `html_url` is
 * `…/Layersky-`, trailing hyphen included. Both derived URLs were checked for
 * a direct `200`, with no redirect, before this changed.
 */
export const GITHUB_REPO_URL =
  'https://github.com/maxencerousseau38-prog/Layersky-';

/**
 * The pull request the landing page's run produced, **when a visitor can open
 * it** — and `null` while they cannot.
 *
 * This was `…/localize-infra-fixture-vite/pull/1`, described here as "a real,
 * merged pull request". Three things were wrong with that, all checkable in one
 * command each, and none checked:
 *
 *   - #1 was never merged. It was closed unmerged on 2026-09-02.
 *   - The fixture repository is **private**, so the link answered 404 to every
 *     visitor. The page's central piece of evidence was a dead link, in four
 *     places, and nothing caught it because the people testing it were signed
 *     in to GitHub as the owner.
 *   - The run the page showed was not #1's: its duration came from another run.
 *
 * The landing page now shows run `b6fbbf11`, which opened #9 — merged, and the
 * real product path. #9 lives in the same private repository, so there is
 * nothing a visitor can follow, and every component that linked here renders
 * the facts without a link instead of a link that fails.
 *
 * **Making the fixture repository public is the one-line fix**: set this to
 * `https://github.com/maxencerousseau38-prog/localize-infra-fixture-vite/pull/9`
 * and the links come back everywhere. Check it signed out.
 */
export const EXAMPLE_PR_URL: string | null = null;

/**
 * The i18next fixture, and the one cycle on it a visitor can open.
 *
 * **This repository is public**, which the Vite fixture above is not — and
 * that difference is why the evidence on this site moved. `EXAMPLE_PR_URL`
 * is null because the run it describes lives in a private repository and the
 * page would have linked a 404 to everyone but its owner. The guardrail's
 * evidence has no such problem: every number below is on a page anybody can
 * load, signed out.
 *
 * Verified against the GitHub API on 2026-10-03, not copied from a note:
 *
 *   - pull request #13 added one English key and no translations;
 *   - the check on `d73683d` was `neutral`, "6 i18n problems", "Checked 1 key
 *     against 6 languages (ar, de, es, fr, ja, pt-BR)", 2026-09-29 13:33 UTC;
 *   - corrective pull request #17 opened against that same branch and added
 *     the six, merged 2026-10-02 16:49 UTC as `e910905`;
 *   - the check on `e910905` is `success`, "No i18n problems found".
 *
 * Changing any figure here means re-reading the check runs. They are the whole
 * argument of the landing page, and the one thing on it that is not a drawing.
 */
export const FIXTURE_REPO_URL =
  'https://github.com/maxencerousseau38-prog/localize-infra-fixture-i18next';

export const EXAMPLE_CYCLE = {
  /** The pull request a reviewer opened. */
  pull: { number: 13, url: `${FIXTURE_REPO_URL}/pull/13` },
  /** The corrective pull request Layersky opened against its branch. */
  correction: { number: 17, url: `${FIXTURE_REPO_URL}/pull/17` },
  checkName: 'Layersky i18n',
  locales: ['ar', 'de', 'es', 'fr', 'ja', 'pt-BR'],
  before: {
    sha: 'd73683d',
    conclusion: 'neutral',
    title: '6 i18n problems',
    summary: 'Checked 1 key against 6 languages (ar, de, es, fr, ja, pt-BR).',
  },
  after: {
    sha: 'e910905',
    conclusion: 'success',
    title: 'No i18n problems found',
    summary: 'Checked 1 key against 6 languages (ar, de, es, fr, ja, pt-BR).',
  },
} as const;

/**
 * The one i18n library the check understands today.
 *
 * Named in a constant because four surfaces say it — the landing, /docs,
 * /roadmap and the status board — and a product that supports one framework
 * must not be described by four separately-written sentences. next-intl and
 * react-intl are *detected* and answered with "not supported", which is a
 * different and better answer than silence; that distinction is drawn where
 * it matters rather than here.
 */
export const SUPPORTED_I18N_LIBRARY = 'i18next';

/**
 * The public channel: an issue anybody can read.
 *
 * Good for a bug, a repository layout the check does not understand, a
 * question about behaviour. Wrong for anything confidential, which is what
 * `SUPPORT_EMAIL` below exists for.
 */
export const CONTACT_URL = `${GITHUB_REPO_URL}/issues`;

/**
 * The private channel.
 *
 * **One constant, four pages.** A public issue tracker is the wrong place for
 * a GDPR request, a private repository's error output, or a signed data
 * processing agreement, so /contact, /privacy, /terms and /dpa all read this
 * rather than each spelling out an address. Two of those are legal documents;
 * an address that appears in one of them and not another is the kind of drift
 * a customer finds first.
 *
 * It stays `string | null` now that it is set, and that is deliberate. The
 * null branch is what every page shows if this mailbox is ever retired, and
 * leaving the type as a bare `string` would mean deleting four fallbacks the
 * day it is needed — which is the day nobody has time to write them.
 *
 * A dedicated alias rather than the owner's personal address. That was
 * offered and declined: an address given to a customer in a contract is one
 * you cannot take back, and a personal mailbox on an indexed page is a
 * different decision from a support alias.
 *
 * **Both branches are rendered and both are tested** (`e2e/legal.spec.ts`),
 * because this repository has already shipped a text branch nobody had ever
 * seen on screen — the `CLI_PERSONAL_TOKENS_LIVE` copy, wrong for weeks in
 * the branch that was not live. The suite asserts whichever branch is live
 * and the absence of the other, so turning this back to null is caught too.
 *
 * Set on 2026-10-03. **What no test here can check is that the mailbox is
 * read.** A support address nobody opens is the failure this constant was
 * null to avoid, moved one step along.
 */
export const SUPPORT_EMAIL: string | null = 'layersky.contact@gmail.com';

/**
 * Who is behind this, in the only terms the repository can support.
 *
 * There is no company. There is an individual GitHub account, which owns the
 * repository, the npm scope and the GitHub App, and that is what the legal
 * pages say. Naming an entity that does not exist would be the one kind of
 * invention a terms page cannot survive.
 */
export const OPERATOR = 'Layersky, operated by maxencerousseau38-prog';

/**
 * The date the legal pages were last written, shown on them.
 *
 * A terms page with no date is a terms page nobody can tell is stale.
 */
export const LEGAL_LAST_UPDATED = '3 October 2026';

/**
 * The hosted application.
 *
 * It exists — accounts, workspaces, projects, GitHub connection, runs — and
 * sign-up is open. The site said for weeks that none of that was built,
 * because the sentences were written before it was and nothing tied them to it.
 * Pages that mention the hosted app read this constant rather than spelling
 * the origin, so attaching a domain is one edit.
 */
export const APP_URL = 'https://localize-infra-web.vercel.app';

/** The hosted API, which the CLI uses by default from 0.3.0. */
export const API_URL = 'https://localize-infra-api.vercel.app';

/**
 * The evaluation harness, which is MIT-licensed.
 *
 * Linked instead of the repository root wherever the surrounding copy claims
 * something is open source: the repository is deliberately mixed-licence
 * (see LICENSE), so "the open-source repository" was never quite true.
 */
export const EVAL_PACKAGE_URL = `${GITHUB_REPO_URL}/tree/master/packages/eval`;

/**
 * Shown on the landing page and in /docs as the way to install the CLI.
 *
 * Whether it *works* is `CLI_PUBLISHED_TO_NPM` below, not something each page
 * decides for itself. The doc comment describing this constant had drifted
 * away from it — two comment blocks in a row, the first orphaned above the
 * second — so the explanation for the command sat on a different export.
 */
export const INSTALL_COMMAND = 'npx @localize-infra/cli init';

/**
 * Whether `@localize-infra/cli` exists on the public npm registry.
 *
 * **One fact, one place.** Two pages make a claim that depends on it — the
 * hero's qualification under the copyable command, and the first paragraph of
 * /docs — and they were separately worded prose. Two hand-written sentences
 * about one external fact is one sentence that gets forgotten, on a site whose
 * stated constraint is that every claim must be true *today*
 * (see docs/frontend/07-milestones.md, FE-1 risks).
 *
 * **Flipping this is part of publishing, not a follow-up.** `docs/releasing.md`
 * lists it as a step in the publish sequence, and e2e tests assert that both
 * pages say whatever this says — so the suite goes red if the flag and the copy
 * ever disagree, in either direction.
 *
 * It is a constant rather than a registry lookup on purpose. Querying npm at
 * build time would make a green build depend on a third party being reachable,
 * and would let the site's honesty change without a commit.
 *
 * Published on 2026-08-28: `@localize-infra/schemas`, `@localize-infra/core`
 * and `@localize-infra/cli`, all at 0.1.0, into an organisation scope that
 * `/-/org/localize-infra/package` now lists all three names under.
 *
 * The flag says *published*, not *which version*, and that is deliberate: it
 * gates copy about `npx` working at all. This sentence said `cli` was "at 0.2.0
 * in the repository and awaiting a publish" — true when written, stale from
 * 2026-09-12 07:43 UTC, when 0.2.0 went to npm and `latest` moved to it. The
 * drift cost nothing precisely because the flag gates the copy and a version
 * does not: the pages it drives say nothing a version could falsify.
 *
 * The earlier note here said the scope was "unclaimed". It was not — that read
 * a 404 on a *package* as evidence about the *scope*, which it never was.
 * `docs/releasing.md` carries the corrected check.
 */
export const CLI_PUBLISHED_TO_NPM = true;

/**
 * Whether the **published** CLI talks to the hosted API with a personal token.
 *
 * Two things have to be true together before this flips, and both happen
 * outside a merge: `@localize-infra/cli@0.3.0` is on npm (0.2.0 still defaults
 * to localhost), and the production API has `SUPABASE_URL` and
 * `SUPABASE_SERVICE_ROLE_KEY`, without which it refuses every personal token.
 * Until then the pages keep describing the CLI that people actually install.
 *
 * Tokens can be *created* in the hosted app before this flips; the pages do
 * not advertise that, because a token the API refuses is not a feature.
 *
 * Flipped in the same change as the 0.3.0 publish — `docs/releasing.md`.
 * `apps/site/e2e/interaction.spec.ts` reads this and asserts the copy follows
 * it in both directions.
 *
 * **True since 2026-09-17.** Both conditions were checked before flipping, not
 * assumed: 0.3.0 is `latest` on npm, and the production API resolved a token
 * issued in the production app — `whoami` answered `layersky`, a real
 * translation and a real pull request went through, and the same token was
 * refused with exit 1 once revoked.
 */
export const CLI_PERSONAL_TOKENS_LIVE = true;

/**
 * What the hosted API allows one workspace, per day, and one token, per minute.
 *
 * Read from here by /pricing and /docs so the published numbers cannot drift
 * from each other. They can still drift from the API, which holds its own copy
 * in `api_limits()` — one SQL function, one constant here, and a test that
 * asserts the pages say what this says. Keeping the two in step is a release
 * step, not something the type system can do: the site is deployed from Git
 * and the function from a migration.
 *
 * They are **abuse ceilings, not meters**. Invariant 3 forbids billing by
 * volume, nothing here is charged for, and a real project does not reach them:
 * 5000 strings a day is a 400-string application translated into five
 * languages, twice over, every day.
 */
export const HOSTED_API_LIMITS = {
  stringsPerDay: 5000,
  pullRequestsPerDay: 50,
  translateRequestsPerMinute: 30,
} as const;
