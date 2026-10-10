# Manual end-to-end test: one real GitHub + model cycle

Status: procedure only. Nothing in this document has been executed as part of
writing it.

## Why this exists

CI cannot run this. The `e2e` job injects **fabricated** GitHub App
credentials, and no seeded organisation carries an installation, so Octokit is
never constructed and no model is ever called. The suite proves the product
against seeded rows and real RLS; it proves nothing about GitHub or the
provider.

So the only evidence that a full cycle works is a human running one. This is
that run, written down so it is repeatable, bounded in spend, and cleaned up
afterwards.

**It is a release check, not a demo.** Run it after any change to the webhook,
the analyser, the corrector, `services/github-app`, or a deployment of
`apps/api` — which does not follow Git and therefore does not update when a
pull request merges.

---

## Prerequisites

Confirm every line before touching the fixture. Each is cheap and each has
caused a failed run.

| # | Check | Command | Expected |
|---|---|---|---|
| 1 | `apps/web` is current | `curl -s https://localize-infra-web.vercel.app/api/version` | `commit` equals `git rev-parse origin/master` |
| 2 | `apps/api` is current **for its own code** | `curl -s https://localize-infra-api.vercel.app/api/version` | then `git diff --stat <that sha> origin/master -- apps/api packages/schemas packages/core services/github-app` is **empty** |
| 3 | API is up | `curl -s https://localize-infra-api.vercel.app/health` | `{"ok":true}` |
| 4 | API refuses anonymously | `curl -s -o /dev/null -w "%{http_code}" -X POST https://localize-infra-api.vercel.app/v1/translate` | `401` |
| 5 | App permissions are the four | `node scripts/github-app-permissions.mjs` | exits `0`, App and installation both report `checks:write contents:write metadata:read pull_requests:write` |
| 6 | The workspace resolves to an installation | SQL below | exactly one row |
| 7 | A provider key is configured | `vercel env ls production` on the API project | `ANTHROPIC_API_KEY` present — **never print the value** |

Step 2 is the one most often skipped and the one that invalidates the whole
run. `apps/api` deploys only by `npx vercel deploy --prod --archive=tgz` from
the repository root; a merged fix is not a deployed fix.

Step 6, read-only:

```sql
select o.slug, ogi.installation_id
from public.organizations o
join public.organization_github_installations ogi
  on ogi.organization_id = o.id;
```

If this returns no row, the webhook will refuse the correction — `#133` made it
fail closed, so the Check will say so rather than translating uncharged. Fix the
row before running, not after.

---

## Subject repository

**`maxencerousseau38-prog/localize-infra-fixture-i18next`** — public, owned by
the operator, i18next, catalogues under `locales/`.

Use this repository and no other. In particular:

- **Never run this against a customer or prospect repository.** Installing the
  App elsewhere to test it is not a test, it is an uninvited write.
- `localize-infra-fixture-vite` is the **legacy pipeline** fixture and is
  private. It is not the subject here.
- The fixture carries 7 locales: `en` (source) plus `ar de es fr ja pt-BR`, so
  one new source key plans **6** units.

---

## Baseline — take it before anything else

An appearing row is only evidence if you know it was absent.

```sql
-- usage for today, before the run
select usage_date, strings_translated, translate_requests, prs_opened,
       model_requests, input_tokens, output_tokens, thinking_tokens, updated_at
from public.api_usage_daily
where usage_date = (now() at time zone 'utc')::date;

-- the check rows that already exist for this repository
select pull_number, left(head_sha,7) as sha, conclusion, title,
       correction_requested, correction_applied, correction_refused,
       corrective_pr_number, created_at
from public.i18n_checks
where repository_name = 'localize-infra-fixture-i18next'
order by created_at desc limit 5;
```

Record the UTC timestamp you took it at. Also note which pull requests are
already open — the fixture accumulates them, and cleanup needs to distinguish
yours from the backlog:

```sh
gh pr list --repo maxencerousseau38-prog/localize-infra-fixture-i18next \
  --state open --json number,headRefName,title
```

---

## The cycle

### 1 — Authenticate and reach the application

Open <https://localize-infra-web.vercel.app/> and sign in.

- **Expect** a redirect to the workspace, not to `/login`.
- Unauthenticated, `/`, `/runs` and `/settings` answer `307`; that is the gate
  working, not a fault.

### 2 — Confirm the GitHub installation

On `/[org]/start`, use the **Verify** button on the GitHub step.

- **Expect** it to confirm the installation reaches the fixture.
- It queries GitHub on demand, not on render — if it reports the installation
  is gone, **stop**. A run would pay for every locale and then fail at the pull
  request.

### 3 — Confirm the slug resolves

```sh
curl -s -o /dev/null -w "%{http_code}\n" -L \
  https://github.com/apps/layersky-i18n/installations/new
```

**Expect `200`.** Nothing reads the slug from the API at runtime — it comes from
`GITHUB_APP_SLUG` — so a stale variable makes "Connect a repository" lead to a
404 with no error and no failing test. Click the link in the product once and
confirm it lands on the App.

### 4 — Add one source key, and only one

Branch from `main` with a name that does **not** start with `localize-infra/`
(that prefix is the loop guard and the webhook will decline the delivery).

```sh
R=maxencerousseau38-prog/localize-infra-fixture-i18next
BRANCH=test/manual-cycle-$(date -u +%Y%m%d%H%M)

BASE=$(gh api repos/$R/git/ref/heads/main --jq .object.sha)
gh api -X POST repos/$R/git/refs -f ref="refs/heads/$BRANCH" -f sha="$BASE"
```

Then add exactly one key to `locales/en/common.json` — nothing else, and no
target locale. Pick a key that does not exist in any locale; confirm it first:

```sh
for l in en ar de es fr ja pt-BR; do
  printf '%s: ' "$l"
  gh api "repos/$R/contents/locales/$l/common.json?ref=main" --jq .content \
    | base64 -d | grep -c '"yourNewKey"'
done
```

**Every line must print `0`.** A key that already exists somewhere changes what
the check is measuring.

Commit it, then open the pull request. **Opening the PR is the single trigger** —
pushing the branch alone fires only a `push` event, which `decideWebhook`
ignores.

```sh
gh pr create --repo $R --base main --head "$BRANCH" \
  --title "test: manual cycle" --body "Adds one English key. Not for merge."
```

### 5 — The delivery

GitHub's delivery timeout is **10 seconds**; the webhook answers in about 3 and
does the work in `after()`. So a `200` here means *received*, not *finished*.

Deliveries are only visible with an App JWT — `gh api` authenticates as a user
and returns 401. There is no committed script for this; if you need it, sign an
RS256 JWT with the key at `GITHUB_APP_PRIVATE_KEY_PATH` and call
`GET /app/hook/deliveries`. It is the **only** source that says whether GitHub
tried and with what code.

### 6–7 — The Check, and the finding

Within ~30 seconds:

```sh
SHA=$(gh pr view <N> --repo $R --json headRefOid --jq .headRefOid)
gh api repos/$R/commits/$SHA/check-runs \
  --jq '.check_runs[] | {name, status, conclusion, output: .output.title}'
```

**Expect** `Layersky i18n`, `completed`, conclusion **`neutral`**, title
`6 i18n problems`, and a summary reading `Checked 1 key against 6 languages`.

- **`neutral` is correct and not a failure.** The check never blocks a merge.
- **"Checked 1 key", not the whole catalogue.** Scope is the keys the PR
  *changed* against `base.sha` — the fork point, not the current tip of `main`.
  If this says more than 1, something else changed on the branch.
- A repository the product cannot read gets a Check saying so, also `neutral`.
  "No problems found" on an unread repository would be the silence this product
  exists to remove.

### 8 — The corrective pull request

```sh
gh pr list --repo $R --state all --limit 5 \
  --json number,headRefName,title,files
```

**Expect** a new PR on a branch prefixed `localize-infra/`, based on **your test
branch** rather than on `main`, touching only files under `locales/`.

Its title carries the honest count: `add 4 of 6 missing translations` when two
were refused, `add 6 missing translations` when none were.

**Expect refusals, and read them.** German and Spanish routinely refuse on
register — formal versus informal address — and the Check names the model's own
question. That is invariant 4 working. A refusal nobody can read is
indistinguishable from a bug, and was taken for one for three deliveries.

### 9 — Verify the correction overwrote nothing

This is the assertion that matters most, because it is the one a customer
cannot forgive getting wrong.

```sh
git clone https://github.com/$R /tmp/fixture-check && cd /tmp/fixture-check
git fetch origin <corrective-branch>
git diff main...origin/<corrective-branch> -- locales/
```

- **Expect** only *added* lines, only the new key, only in target locales.
- **Any modification to an existing translation is a stop condition.**
  `insertKeys` is supposed to make it impossible — an existing value is skipped
  as `already translated`, and a key that would turn a value into a group is
  skipped with a reason. If the diff shows otherwise, stop and keep the branch
  as evidence.
- The source file must be untouched. The corrector never writes `en`.

### 10 — Re-analysis after correction

Merge the **corrective** PR into your test branch. That fires `synchronize` on
the test PR and re-runs the same check.

```sh
gh pr merge <corrective-N> --repo $R --squash --delete-branch
# wait ~30s, then re-read the check on the new head
```

**Expect** the problem count to fall by the number applied — `6 problems` → `2
problems` if two were refused. The refused ones must still be reported: merging
a partial correction does not resolve them, and the PR body says so.

### 11 — Ambiguity refusals

Already observed in step 8. Confirm the Check text carries the model's question
verbatim, and that no translation was committed for a refused locale.

```sql
select correction_requested, correction_applied, correction_refused,
       correction_note
from public.i18n_checks
where repository_name = 'localize-infra-fixture-i18next'
order by created_at desc limit 1;
```

`requested = applied + refused`, always. That identity is structural since
`#134`; if it does not hold, a path is losing work silently and that is a stop
condition.

### 12 — Usage, and what it should say

```sql
select usage_date, strings_translated, translate_requests, prs_opened,
       model_requests, input_tokens, output_tokens, thinking_tokens
from public.api_usage_daily
where usage_date = (now() at time zone 'utc')::date;
```

For one key across six locales, expect roughly:

| Column | Expected |
|---|---|
| `strings_translated` | +6 — charged for what is **sent**, not what survives the re-audit |
| `translate_requests` | +1 — one atomic charge for the whole plan |
| `prs_opened` | +1 — charged **before** translating, so it increments even if nothing is opened |
| `model_requests` | **+6** — one call per locale |
| `input_tokens` | ~9,800 |
| `output_tokens` | ~750, and highly variable |

**`model_requests = 6` is the assertion to make, not "the columns are
non-zero".** The response schema defaults `usage` to zeros, so zeros cannot
distinguish "no tokens" from "no reporting" — a request count can.

If the token columns are zero while `model_requests` is zero too, the deployed
API is not reporting usage: check prerequisite 2.

---

## Stop conditions

Stop, record what you have, and do not re-run:

1. Any existing translation modified or removed (step 9).
2. `requested ≠ applied + refused` (step 11).
3. A corrective PR based on `main` rather than on the test branch — it would
   target the default branch.
4. A corrective PR touching anything outside `locales/`.
5. A Check with conclusion `failure` — the product never emits one.
6. A second corrective PR for one delivery, or a corrective PR that itself gets
   analysed: the loop guard has failed.
7. The English source file modified.
8. `/v1/translate` returning a provider error body — it should be logged, not
   returned, since it can quote a rejected key.

---

## Spend and safety

- **One cycle costs about $0.03.** Measured 2026-10-09: 6 calls, 9,847 input and
  757 output tokens, **$0.027264** derived at the published rate. That figure is
  consumption times a published rate — **no provider invoice has been compared
  to it**.
- Bounds that apply whatever you do: `MAX_CORRECTION_UNITS = 40` per delivery,
  `MAX_ATTEMPTS = 3` per chunk, and the workspace ceiling (`api_limits()`:
  5,000 strings and 50 pull requests a day).
- **Add one key, not twenty.** Scope is what drives cost; a large reformatting
  commit makes a long scope and a boring result.
- Never print a secret. Prerequisite 7 checks that a name is present, not what
  it holds.
- Do not raise a ceiling to make a run fit. If a run does not fit, it is the
  wrong run.
- The fixture is public, so everything committed is public. Use nothing real.

---

## Cleanup

Leftover pull requests are not harmless: each is a branch the next run has to
distinguish from its own, and the fixture has accumulated them before.

```sh
R=maxencerousseau38-prog/localize-infra-fixture-i18next

# your test PR, and any corrective PR not already merged in step 10
gh pr close <N> --repo $R --delete-branch

# then confirm what is left, and compare against the baseline you recorded
gh pr list --repo $R --state open --json number,headRefName,title
git ls-remote --heads https://github.com/$R 'refs/heads/localize-infra/*'
```

- **Leave `main` untouched.** Nothing in this procedure merges to `main`.
- Any `localize-infra/*` branch left behind is a corrective branch whose PR was
  closed without `--delete-branch`.
- If you merged the corrective PR in step 10, that is a merge into your *test
  branch* only, and closing the test PR discards it.

**Record the run** — date, head SHA, check conclusion, requested/applied/refused,
the usage row, and the cost. The value of this procedure is the series, not any
single pass.

---

## What this procedure does not cover

- **Private repositories.** They need `organization_entitlements.private_repositories`
  set by hand in SQL; there is no product path, and granting it is a separate
  decision.
- **next-intl and react-intl.** Detected, declared unsupported.
- **Catalogues outside `locales/`.** Analysis reads `public/locales` and
  `src/locales` too, but the corrector writes only `locales/`, so such a
  repository is analysable and not correctable. `correctableDirectory` says so
  before spending.
- **A lost run.** The work lives in the invocation; if the function dies there
  is no queue and no resume.
- **Invoice reconciliation.** See spend, above.
