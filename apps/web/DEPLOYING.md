# Deploying apps/web

Vercel project `localize-infra-web`, Root Directory `apps/web`, functions in
**cdg1 (Paris)** via `vercel.json`. Live at
https://localize-infra-web.vercel.app.

The region is a requirement, not a default. Invariant 5 puts customer data in
the EU, and that has to include where the code runs, not only where the rows
rest — a function in Washington reading a database in Paris moves the data to
Washington. Supabase is `eu-west-3`; this matches it. Verified on the response:
`X-Vercel-Id: cdg1::cdg1`.

## How it deploys, and why that detail matters

**There is Git integration.** This section said there was none, and the
paragraph below predicted exactly what connecting it would change. Both halves
have now happened: merging to `master` deploys production, opening a pull
request deploys a preview with its own GitHub check. Observed 2026-08-23 on
PR #31.

The practical consequence, and the reason this is not a cosmetic correction: an
environment-variable change no longer waits for someone to run the CLI. It
applies on the next merge, which may be a merge that has nothing to do with it.

The CLI archive upload still works and remains the fallback. It runs from the
*repository root*, not from `apps/web`:

```sh
VERCEL_ORG_ID=team_jkFQHiZ8OitJujErZvg9oJFb \
VERCEL_PROJECT_ID=prj_L5FZPh16GE88nLtgPbOnb2LR5e3f \
npx vercel deploy --prod --archive=tgz
```

The env-var override is what makes this safe to run from the root: the root
`.vercel` link belongs to `localize-infra-site`, and without the override this
command would deploy the marketing site.

Uploading from the root is also what makes the build correct.
`src/app/globals.css` contains

```css
@source '../../../../packages/ui/src';
```

That path climbs out of `apps/web`. Because the whole repository is uploaded,
Tailwind finds it and the shared component utilities compile. Measured on the
live deployment: **184,840 bytes** of CSS across two chunks, containing
`bg-confident-bg`, `bg-degraded-bg`, `text-ambiguous-text`,
`text-confident-text`, `outline-failed`, `bg-active` and `bg-overlay` — classes
that appear in `packages/ui/src` and **nowhere** in `apps/web/src`. If those are
present, the directive resolved. That is the check to repeat, not the byte count
alone.

**That prediction came true, and the check passes.** Vercel now clones and
builds with `apps/web` as the root, which makes the "Include source files
outside of the Root Directory in the Build Step" setting load-bearing — off,
the build still goes green and roughly 30% of the stylesheet silently
disappears (measured on `apps/site`: 44,377 B → 30,911 B). The Vercel CLI does
not expose that setting, so it has to be toggled in the dashboard.
`docs/deploying.md` has the full account.

Re-measured on the git-built production deployment, 2026-08-23: **184,611
bytes** across two chunks, with `bg-confident-bg` and `text-ambiguous-text`
both present. Those classes cannot reach the output unless the directive
resolved, so the setting is on — established from what is served rather than
from reading the toggle.

## Environment

| Variable | Set on Vercel | Why |
|---|---|---|
| `SUPABASE_URL` | yes | Auth, workspaces, projects |
| `SUPABASE_PUBLISHABLE_KEY` | yes | Protected by RLS, not a secret |
| `LOCALIZE_API_URL` | yes | `https://localize-infra-api.vercel.app` |
| `LOCALIZE_API_TOKEN` | yes | Bearer for `/v1/*` |
| `GITHUB_APP_ID` | yes | Reading the repository tree |
| `GITHUB_APP_PRIVATE_KEY` | yes | The PEM inline; the `_PATH` form is local-only |
| `GITHUB_APP_SLUG` | yes | Builds the App installation URL |
| `GITHUB_OAUTH_CLIENT_ID` | yes | Proves the caller owns the installation they name. Read from `GET /app` — see below |
| `GITHUB_OAUTH_CLIENT_SECRET` | yes | Completes the pair the callback needs. Set by hand on 2026-08-28 — see below |
| `GITHUB_WEBHOOK_SECRET` | yes, for the i18n check | HMAC secret shared with the GitHub App's webhook. `/api/github/webhook` refuses every delivery with 503 while it is empty, and says which variable — the only way to tell an unset value from one `vercel env add` wrote blank in a non-interactive shell, which `vercel env ls` lists as present |
| `SUPABASE_SERVICE_ROLE_KEY` | yes, Production only | Writes the GitHub link after the callback verifies it. **No longer the only use:** `record_i18n_check`, `consume_api_quota`, the installation lookup, model-usage recording and the Closer activation metrics all go through it, each establishing authority in `apps/web` first. Bypasses RLS: server-only, never `NEXT_PUBLIC_`. Set by the owner on 2026-09-16 — see below |

**Two rows left this table on 2026-08-23**, removed from the project rather
than merely undocumented: `GITHUB_APP_INSTALLATION_ID` and
`GITHUB_OPERATOR_EMAILS`. Neither is read by any non-test file in `apps/web`.
The seven that remain were each checked individually, which is what makes this
list current rather than merely shorter.

**This said `GITHUB_APP_INSTALLATION_ID` had to stay on the
`localize-infra-api` project, and that removing it there returns 501 on the
route.** True when it was written; outdated once the API split credentials from
installation. It is now only a default for a request that names no
installation, and both callers here always name the workspace's. It was
removed from the API's Production environment on 2026-09-17, and a request
naming the installation still reaches GitHub (checked: 409 on identical
content). Only a request naming **none** gets 501.

This table used to say the opposite, and the reasoning it gave was sound at the
time: the pipeline would have pointed at `127.0.0.1:8787`, the App private key
would have travelled for nothing, and enabling it would move the invariant-5 gap
onto a public URL. The first two stopped being true when `apps/api` was
deployed. The third is still true and was accepted deliberately on 2026-08-19 —
see `apps/api/DEPLOYING.md` and CLAUDE.md.

**`GITHUB_OPERATOR_EMAILS` was never an authorization boundary.** This said it
was "the live authorization boundary", that connecting a repository was
restricted to its addresses, and that `isOperator` failed closed on an empty
value. `isOperator` had no callers at all — the whitelist enforced nothing, and
three places described it as what separated tenants (#24). It and the variable
are both gone.

What separates tenants is structural on both paths now.
`organization_github_installations` holds an installation per organisation,
`resolveInstallation` cannot express a shared one, and `/v1/open-pr` takes an
`installationId` so the pull request is opened by the same installation that
read the repository. The write path did not do this and was blocker 2b.

**The step before all of it is now multi-tenant too.** This said no customer
could trigger their own installation while `GITHUB_OAUTH_CLIENT_ID` /
`GITHUB_OAUTH_CLIENT_SECRET` were missing, so in practice there was one
installation on this deployment — the operator's. The pair is complete since
2026-08-28, `readOAuthConfig()` returns it, and `canInstall` is true, so the
button is rendered rather than replaced by its blockers.

**Both are set.** The id came from `GET /app` authenticated as the App on
2026-08-23 — it is public by construction, it appears in every authorize URL a
user sees. The secret could not follow the same way: no API returns it, GitHub
shows it once at generation in the App's settings page. That asymmetry is why
one half of this was automatable and the other had to be typed by a person, on
2026-08-28.

**The evidence is not the setting, it is what the setting produced.**
`organization_github_installations` holds installation `151289538`
(`maxencerousseau38-prog`) for `layersky`, written on 2026-08-28 at 12:26 by the
OAuth flow in the interface — the only path that needs the secret, since it is
the exchange of `code` for a user token, followed by checking the installation
against what that token can reach. A row placed by hand would look identical in
the database; the owner confirmed which path was taken.

So the callback can now prove that whoever completes an install owns it, which
is the whole reason the flow was withheld while the pair was incomplete.

Two settings on the App are still neither writable nor *readable* through the
API: "Request user authorization (OAuth) during installation", and the callback
URL `https://localize-infra-web.vercel.app/github/callback`. `GET /app` has no
field for them, and probing `login/oauth/authorize` cannot tell a registered
callback URL from an unregistered one, because GitHub redirects to its login
page before it validates `redirect_uri`. That shortcut was checked and does not
exist.

They no longer need one. A flow that ran to completion and wrote the row proves
both settings are correct — which is the evidence probing could never supply.

This is how it was added, and how it would be rotated — by whoever generates
it, in their own terminal:

```sh
VERCEL_ORG_ID=team_jkFQHiZ8OitJujErZvg9oJFb \
VERCEL_PROJECT_ID=prj_L5FZPh16GE88nLtgPbOnb2LR5e3f \
npx vercel env add GITHUB_OAUTH_CLIENT_SECRET production
```

It prompts for the value, so the secret never travels through a shell history
line, a file, or a conversation.

## Production has its own database

Production points at `localize-infra-prod` (`ijgheekdihgssktyweyy`, eu-west-3).
Development and the acceptance suite keep `localize-infra`
(`aguwalokxfgtqbzmdjbs`). Only the **production** Vercel environment was
repointed; preview and development still resolve to the development project, so
a preview deployment cannot write to customer data.

This split closed a real exposure rather than a tidiness complaint. The two
shared one database, and `supabase/seeds/dev-user.sql` writes an account whose
password is committed to this repository — so it authenticated against the
public deployment. Verified before, and verified again after: the same request
now returns `Invalid login credentials`.

Verified end to end, not inferred from the environment variable: a confirmed
user created **only** in the new production database signed in on
`localize-infra-web.vercel.app` and landed on `/onboarding` — "Create a
workspace" — which is the correct screen for a database with zero
organizations. That probe user was deleted afterwards.

**This then said "production is empty", and it is not.** Counted 2026-08-23:
1 user, 1 organization, 0 projects, 0 runs, 0 installations. The account is the
owner's own (`layersky`, created 2026-08-18) — it was for a time written up as
an independent third-party signup, which it never was. The seeded development
account remains refused; that is the claim this paragraph was actually built to
support, and it still holds.

"NOT for production" was a sentence in a comment, and a sentence in a comment
stops nothing. The rule is now enforced: the production database carries a
stamp applied out of band —
`comment on database postgres is 'localize-infra-production'` — and the seed
reads it and refuses. Out of band because a migration replays into development
too and so could not distinguish the two. `supabase/README.md` has the detail.

The remaining caveat is the plan, not the data: `localize-infra-prod` is on the
free tier, which pauses on inactivity and is not where a real customer database
should live long-term.

## Signup is open

Anyone reaching the URL can create an account and a workspace. That is the
product working, and it is worth knowing what does and does not bound it.

Running the pipeline is **not** operator-gated — this said it was, and the gate
was removed with `isOperator` in #24.

This paragraph then said a new workspace "cannot create [a GitHub installation]
while the OAuth secret is missing". That stopped being true on **2026-08-28**,
when the secret was set by hand: the table above and the section below were
corrected that day and this sentence was not, so one file argued with itself
for two weeks. `readOAuthConfig()` returns the pair, `canInstall` is true, and a
new workspace connects its own installation from the interface.

What actually bounds it is repository scope:
`organization_entitlements.private_repositories` has no product path and is
granted by hand, so a new workspace reaches **public repositories only**. That
is a structural limit, not a whitelist.

Vercel's `ssoProtection` is set to `all_except_custom_domains`, which is the
default and does **not** cover the production alias — `localize-infra-web.vercel.app`
is served to anonymous requests. Password protection requires a paid plan.

## Which commit is live

```bash
curl -s https://localize-infra-web.vercel.app/api/version
# {"commit":"d4ef407…","environment":"production"}
```

The endpoint is public, and it exists because this question had no cheap answer.
`apps/site` could always be checked from outside: its deployment URLs are
anonymous, so the production alias can be compared to a *named* deployment byte
for byte. `apps/web` could not. `ssoProtection` is
`all_except_custom_domains` (see above), which leaves the production alias open
but puts every `localize-infra-web-<hash>.vercel.app` behind Vercel SSO — so
there was nothing to compare the alias *to*.

That gap was not theoretical. When the Vercel Git integration lost access to the
repository for a week (2026-09-05 → 2026-09-12, recorded in CLAUDE.md), the site
could be proven stale and then proven fresh; the web app could only be *reported*
deployed by Vercel. Worse, the commit that reopened the pipeline changed nothing
under `apps/web`, so its build output was byte-identical to the stale one —
no amount of comparing content could have distinguished them.

Two things to know when reading the answer:

- `commit` is **null**, not a fabricated value, when the variable is absent —
  `next dev`, a self-hosted build, a project with no repository connected.
  Vercel sets these Git variables to an empty string in that last case, which is
  why empty is treated as absent.
- `environment` distinguishes `production` from `preview`. A preview URL
  answering `"production"` would mean the alias is not what you think it is.

It is read at **request** time, not baked in at build time. A value compiled into
the bundle proves what the bundle was built from, which is the same question one
step removed; read at runtime it comes from the deployment actually serving.

Protection is an allow-list in `lib/supabase/session.ts`, so this route had to be
opened deliberately — and `e2e/auth.spec.ts` asserts it answers signed out, with
`maxRedirects: 0` so that a redirect to `/login` cannot pass as a 200.

## The service-role key, and the one thing it does

`SUPABASE_SERVICE_ROLE_KEY` is the production project's secret key (Supabase
dashboard → Project Settings → API keys → secret). It bypasses row-level
security, so it has exactly one caller: `lib/supabase/admin.ts`, used by
`/github/callback` to write the workspace's GitHub link.

It exists because the database stopped accepting that write from signed-in
users (migration `20260916000200`), for two reasons found on 2026-09-16:

- the old guard, `org_role(org) not in ('owner','admin')`, is NULL for a
  non-member, so a non-member could write — and delete — another workspace's
  link; reproduced on the development database;
- even a correct role check never proved the caller controls the installation
  id, which only the OAuth callback asks GitHub. A direct RPC call skipped it.

The callback now verifies ownership with the user's GitHub token, reads the
user with `getUser()`, and writes as the service role, passing that user; the
function checks the user's role itself.

**Without the key, connecting a new GitHub account fails closed**: the panel
hides the button and names `SUPABASE_SERVICE_ROLE_KEY` as missing, and a stale
callback reports `link-not-configured` on the projects page. Existing links are
read under RLS and keep working.

Set it for **Production** only. Preview deployments do not need to connect
GitHub, and a key that bypasses RLS should not be spread wider than its use.
Like every variable here, it applies on the next deployment — the next merge.

**Set on 2026-09-16, and what that does and does not prove.** The owner added
the key to Production before PR #92 was merged, so the deployment of `4d7b675`
was built with it. Two things were checked from outside afterwards: no served
HTML or JS on `/login` and `/` contains `sb_secret_`, `service_role`, the
variable name or the Supabase URL; and migration `20260916000200` is live, with
`link_github_installation` executable by `service_role` only.

What cannot be seen signed out is whether the running deployment reads the
key. The panel only shows it on a workspace with no GitHub link: *Connect
GitHub* means the key is there, `Missing: SUPABASE_SERVICE_ROLE_KEY` means it is
not. A workspace that is already connected shows neither.

## The GitHub App's permissions, and the two that should not be there

`GET /app` reports six, and the installation holds all six:

```
checks: write          the i18n check on the commit
contents: write        read a pull request's files, create a branch, commit
metadata: read         granted to every App; lists reachable repositories
pull_requests: write   open the corrective pull request
artifact_metadata: write    nothing in this repository reads it
codespaces_metadata: read   nothing in this repository reads it
```

Verified on 2026-10-03: `grep -rn "artifact_metadata\|codespaces_metadata"`
across the whole repository matches only prose about them. They are real
excess permission on every installation, and `/security` lists them for that
reason rather than quietly omitting them.

**There is no API for this.** `PATCH /app` with `default_permissions` answers
**404** authenticated as the App — the endpoint does not exist. Permissions are
a form on
`https://github.com/settings/apps/localize-infra/permissions`, and removing
them is a manual step somebody has to take.

### Why this is not the September trap, and how to be sure

`CLAUDE.md` records a day lost to this: changing an App's permissions is a
*request*, the existing installation keeps the old set until the owner accepts,
no banner ever appeared, and the only way out was uninstall-and-reinstall —
which minted a new `installation_id` and broke "Run pipeline" until the row in
`organization_github_installations` was updated.

That episode was an **addition** (`checks: write` and the `pull_request`
event). GitHub applies a **narrowing** immediately and asks nobody, because no
installation is being granted anything. So removing these two should need no
acceptance at all.

"Should" is not a check. Do it in this order and stop if a step disagrees:

1. Untick both on the permissions form and save.
2. `GET /app` — the two are gone from `permissions`.
3. `GET /app/installations/166148995` — the two are gone from `permissions`,
   and `checks`, `contents`, `metadata` and `pull_requests` are all still
   there. **This is the step that matters.** If the installation still lists
   them, the change is pending acceptance and the narrowing did not apply;
   leave it pending rather than reinstalling, because a reinstall changes the
   installation id.
4. Emit an installation token and confirm it still lists the repositories it
   should reach, and can still write a check run. An installation whose
   permissions were edited and which can no longer post a check is a silently
   broken correction loop.

Steps 2 to 4 are one command, because both reads need a JWT signed with
`GITHUB_APP_PRIVATE_KEY_PATH` and `gh api` answers 401 for them — it
authenticates as a user:

```sh
node scripts/github-app-permissions.mjs
```

It prints what the App asks for and what each installation holds, and exits
non-zero while they disagree or while a permission nothing in this repository
uses is still granted. **Today it exits 1** and names the two. Run it again
after saving the form; the run that exits 0 is the one that closes this.
