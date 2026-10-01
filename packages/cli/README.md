# @localize-infra/cli

The `localize-infra` command-line tool. It ships a single command, `init`,
which runs the full pipeline end-to-end:

1. **Detect** your project's framework.
2. **Extract** hardcoded UI strings from your source files.
3. **Write** `locales/en.json` (the source-of-truth catalog).
4. **Translate** each extracted string into every requested target locale,
   by calling `apps/api`'s `/v1/translate` endpoint, and write
   `locales/<locale>.json` for each one.
5. **Optionally open a pull request** (`--open-pr`) containing the updated
   locale files, by calling `apps/api`'s `/v1/open-pr` endpoint, which in
   turn uses `services/github-app` to create the PR via a GitHub App
   installation.

Steps 4 and 5 talk to an `apps/api` instance — by default the production
deployment at `https://localize-infra-api.vercel.app`, or one you run yourself
(see `apps/api/README.md`). `init` does not call any LLM or GitHub API
directly itself.

**Authenticate with a personal CLI token.** Create one in the Layersky
web app, under your workspace's *CLI tokens*, and set it in
`LOCALIZE_API_TOKEN`. It is shown once, expires, and can be revoked on its
own. A token acts for that workspace only: pull requests are opened through
the workspace's own GitHub connection, and nowhere else.

Before writing or translating anything, `init` checks the token — and, with
`--open-pr`, that the repository and base branch are reachable. A revoked
token, a workspace with no GitHub connection, an unreachable repository or a
missing branch is reported in one sentence and costs nothing. To use your own
`apps/api` instead, point `--api-url` or `LOCALIZE_API_URL` at it.

### Exit codes

| Code | When |
|---|---|
| `0` | At least one locale was translated, and the pull request (if asked for) was opened or had nothing to open |
| `1` | `init` refused to start, no locale could be translated, or the pull request could not be opened |

A pull request that fails after translation keeps the per-locale summary: the
files are written to `locales/`, and the reason is printed after them.

## Data sent to `apps/api` during translation — please read

When the translation step runs, for every extracted string `init` sends its
**file path, its detected component name, and a snippet of the surrounding
source code** (in addition to the string's text) to `apps/api`.
`apps/api` forwards this to a **third-party LLM provider — Anthropic or
OpenAI — to produce the translation**. This is deliberate: the surrounding
code and file/component context measurably improve translation quality
(e.g. disambiguating a short string like "Close" as a button vs. a modal
title). It also means that context leaves your machine and is sent to a
non-EU-hosted third party. **With the default settings, the `apps/api`
instance that receives it is the hosted production deployment** (functions in
Paris, model provider in the United States) — not a server you run. This is a known, deliberate limitation of this
pre-alpha milestone (see `CLAUDE.md`'s "État actuel" section) — full EU data
residency is not yet implemented. Do not run `init` with `--open-pr` or
without `--api-url` pointed at a trusted `apps/api` instance on source trees
containing text you don't want sent to Anthropic/OpenAI.

## Building and running locally

This package depends on `@localize-infra/core`'s build output
(`packages/core/dist/`, which is gitignored and not checked in). Build core
first, then run the CLI directly with `tsx`:

```bash
npm run build -w @localize-infra/core
npm exec -w @localize-infra/cli -- tsx src/index.ts init <directory>
```

If you skip the core build step on a fresh clone, `@localize-infra/core`
will fail to resolve (`main` points at `./dist/index.js`) and both the CLI's
dev script and its tests will fail. CI doesn't hit this because
`turbo run test` has `dependsOn: ["^build"]`, which builds `core` before
`cli` automatically — but it isn't automatic when running things locally
package-by-package.

To translate, you need an `apps/api` to talk to: the production one with an
operator-issued token, or your own (see `apps/api/README.md`) with
`--api-url`. Extraction-only usage is not a supported mode of
`init` — an API token is required even just to write `locales/en.json`,
since `init` always attempts the translation step afterward.

## Usage

```bash
localize-infra init [directory] [--force] [--api-url <url>] [--api-token <token>] [--locales <list>] [--open-pr] [--owner <owner>] [--repo <repo>] [--base-branch <branch>]
localize-infra --help
localize-infra --version
```

- `directory` — defaults to the current working directory.
- `--force` — by default, `init` refuses to overwrite an existing
  `locales/en.json` if doing so would drop keys that are no longer produced
  by the current extraction (e.g. a hand-maintained catalog, or source text
  that changed since the last run). Pass `--force` to proceed anyway and
  let those keys be removed.
- `--api-url <url>` — base URL of the `apps/api` instance to translate
  against and (if `--open-pr` is set) open a PR through. Defaults to
  `https://localize-infra-api.vercel.app`, the production deployment. Also
  readable from `LOCALIZE_API_URL` when the flag is absent — the flag wins when
  both are set. A trailing slash is ignored. For a local instance, pass
  `--api-url http://localhost:8787`.
- `--api-token <token>` — bearer token sent as `Authorization: Bearer
  <token>` to `apps/api`. **Prefer the `LOCALIZE_API_TOKEN` environment
  variable instead**: passing the token on the command line leaks it into
  shell history and process listings (e.g. `ps`). If both are set,
  `--api-token` takes precedence. One of the two is required — `init` fails
  fast, before writing anything, if no token is configured.
- `--locales <list>` — comma-separated list of target locales to translate
  into (e.g. `de,ja,es`). Defaults to `de,ja,es,ar,pt-BR`.
- `--open-pr` — after translation, open a pull request containing the
  updated locale files via `apps/api`'s `/v1/open-pr` endpoint. Requires
  `--owner` and `--repo` (see below); `init` validates both are present and
  well-formed *before* running the (billed) translation step, so a missing
  or malformed `--owner`/`--repo` fails immediately rather than after every
  locale has already been translated.
- `--owner <owner>` — GitHub repository owner (user or org) to open the PR
  against. Required when `--open-pr` is set.
- `--repo <repo>` — GitHub repository name to open the PR against. Required
  when `--open-pr` is set.
- `--base-branch <branch>` — base branch for the PR. Defaults to `main`.
- `-h`, `--help` — print usage and exit. Recognised anywhere in the arguments,
  so `localize-infra init --help` prints help rather than starting a run that
  calls a model and bills for it.
- `-v`, `--version` — print the installed version and exit. Read from the
  package manifest, so it cannot disagree with what npm installed.

### When there is nothing to open (0.2.0)

`--open-pr` against a repository that is already fully translated **no longer
fails, and no longer opens an empty pull request.** It prints:

```
No PR opened: every translation is already on the base branch.
```

Before 0.2.0 the API opened a pull request containing zero changed files —
Git deduplicates blobs by content, so committing files identical to the base
branch produces a commit with no diff and a pull request with nothing in it.
Five of those accumulated on one repository in two days.

The check is made by `apps/api`, not here, because only it knows what the base
branch holds: this command runs against your working directory, which may
already differ from the remote, so a comparison made locally would answer a
different question. The endpoint answers `409` and this command reports it as
the outcome it is.

**If you are on 0.1.0**, an up-to-date repository gives you a raw API error
instead of that sentence. The empty pull request is already prevented — the
refusal lives in the API — but the message is only readable from 0.2.0 on.

### Environment variables

| Variable             | Purpose                                                                 |
| -------------------- | ----------------------------------------------------------------------- |
| `LOCALIZE_API_URL`   | Base URL of the `apps/api` instance to use. Overridden by `--api-url`.  |
| `LOCALIZE_API_TOKEN` | Bearer token for `apps/api`. Preferred over `--api-token` (see above). |

The flag wins over the variable for both, and **an empty value counts as
absent rather than as an override**. `LOCALIZE_API_URL=` in a shell profile,
or a CI secret that resolved to nothing, would otherwise replace the default
with an empty string and send every request to `/v1/translate` with no origin
— a fetch error naming a URL nobody typed.

The default was `http://localhost:8787` up to 0.2.0, so an unmodified install
reached nothing. It is now the production API. `LOCALIZE_API_URL` remains the
way to use your own instance without retyping `--api-url` on every run.

## Supported frameworks

Framework detection lives in `packages/core`'s `detectFramework`. Currently
supported:

- Next.js
- Vite + React
- React Native

See `packages/core/src/detect/index.ts` for the exact detection signals and
source globs used per framework.

## Known extraction limits

These are honest boundaries of the current extractor, not a TODO list:

- Only JSX text content and a small attribute whitelist
  (`placeholder`, `alt`, `title`, `aria-label`) are scanned. Most other
  common attributes (`label`, `description`, etc.) aren't picked up yet.
- Strings inside JSX expressions — ternaries, template literals, `{someVar}`
  — are not extracted.
- **Known gap, not yet resolved:** a JSX element with embedded expressions,
  e.g. `<p>You have {count} messages</p>`, gets extracted as separate text
  fragments around the expression rather than as one placeholder-aware
  string. Translating those fragments independently would produce broken
  word order in some target languages. Fixing this requires redesigning the
  extraction data model to group a JSX element's full children into one
  ICU-aware string, and is deferred — it is not addressed in this phase.
- Test, spec, and story files (`*.test.tsx`, `*.spec.tsx`, `*.stories.tsx`)
  are skipped so fixture/story text never pollutes the real catalog.
- Purely numeric/punctuation/currency strings (e.g. `42`, `$9.99`) and bare
  HTML entities (e.g. `&nbsp;`) are filtered out as noise, not real UI text.
