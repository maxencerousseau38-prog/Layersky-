# Unit economics

Date: 2026-08-21, revised 2026-08-22, 2026-10-03, 2026-10-10
Status: the model exists and the P0 it uncovered is fixed. No price is published
yet, and none should be until the two open questions at the end are closed.

**2026-10-10: repriced, and a production measurement added.** Anthropic made
Sonnet 5's $2/$10 introductory rate permanent and cancelled the rise to $3/$15,
so every dollar figure here fell by a third. The first production correction
with token accounting is recorded in the addendum.

This closes the half of `08-critique.md` §C3 that could be closed. §C3 refused
to let a price be published because the unit economics were "rough arithmetic"
— a table of plausible figures with no provenance. What follows is measured
where measurement was possible, and labelled where it was not.

Every number here comes from `packages/pricing`, which writes
`src/report/cost-model.json`. A test asserts that the committed artefact matches
its generator, so no figure can be edited into **that file**.

**This document is a different matter, and the distinction cost six weeks of
accuracy.** There is still no generator for this prose: its figures are
transcribed from the artefact by hand. On 2026-08-24 two commits (#40, #41)
moved `costPerThousandPairs` from 1.5492 to 1.8342 and updated the artefact
without updating this page, so every headline figure here was wrong until
2026-10-10 — including the claim immediately above, which was read as covering
the document it appears in. Figures below were re-transcribed on 2026-10-10.

Since #153 the transcription is no longer unchecked:
`packages/pricing/src/report/document.test.ts` holds the **selected** figures to
their sources, so that particular drift now fails a test instead of going
unnoticed. What it covers, and what it deliberately does not, is at the end.

---

## The answer, first

| | Cost/month | What it is |
|---|---|---|
| **Typical customer** | **$0.54** | 800 strings, 5 locales, 60 new strings/month |
| **Heavy customer** | **$24.06** | 4 projects × 2,500 strings, 12 locales, on every merge |
| **Worst realistic** | **$439.86** | 10 projects × 12,000 strings, 25 locales, CI on every merge |
| **Adversarial, uncapped** | **$12,350 per run** | §C3's 1M strings × 10 locales |

Month one is different, and it is the number that decides whether a plan
survives:

| | Month one | Steady state | Year one |
|---|---|---|---|
| Typical | $5.98 | $0.54 | $11.97 |
| Heavy | $187.08 | $24.06 | $451.79 |
| Worst realistic | $4,515.36 | $439.86 | $9,353.85 |

**§C3 was right about the shape and wrong about the magnitude.** It predicted
month one would consume "almost the entire month's revenue"; for the typical
customer it consumes 31% of a $19 plan, which is survivable. For a heavy
customer it consumes 1.9× a $99 plan, which is not.

### The unit everything reduces to

**$1.22 per 1,000 string-locale pairs.**

Checked against a real run, and the check is less flattering than it used to
read. The benchmark in `docs/product/10-model-benchmark.md` translated 414
strings on the recommended configuration and billed **$1.47 per 1,000 pairs at
the then-current $3/$15**; the same token consumption at today's rate is
**$0.98**. The model is therefore **25% high**, not the 5% this page claimed —
that 5% compared the benchmark against the 1.5492 figure the model carried
before the 2026-08-24 re-measurement raised it to 1.8342. The direction is
still the safe one, and the magnitude was understated by five times.

Re-pricing the benchmark is exact rather than approximate: input and output
both fell by one third, so any mix of the two scales by two thirds.

One string translated into 25 languages costs 25 times one string translated
into one. Strings are not the driver and neither are runs — the pair is what
the bill is made of, and every figure above is this number times a shape.

| Configuration | Per 1,000 pairs |
|---|---|
| `claude-sonnet-5`, `effort: low` (recommended) | **$1.22** |
| `claude-sonnet-5`, at the default effort | $2.06 |
| `claude-haiku-4-5`, thinking disabled | $0.61 |

---

## What measuring found, and it was not a cost problem

**The pipeline returned nothing above roughly thirty strings.** Not a truncated
answer — no answer at all. **Fixed, and the fix is verified below.**

`claude-sonnet-5` runs adaptive thinking by default, thinking tokens are billed
as output, and `apps/api/src/router/anthropic.ts` set `max_tokens: 4096`.
Nothing in the send path chunked: `run-actions.ts` put every pending string for
a locale into one request. Verified with real calls against the configured
model and this repository's own prompt and corpus:

| Strings | `stop_reason` | Thinking tokens | Output tokens | Usable |
|---:|---|---:|---:|---|
| 5 | `end_turn` | 82 | 413 | 5 of 5 |
| 10 | `end_turn` | 442 | 1,206 | 10 of 10 |
| 20 | `end_turn` | 1,799 | 3,186 | 20 of 20 |
| 40 | `max_tokens` | **4,096** | 4,096 | **none — empty response** |
| 80 | `max_tokens` | **4,096** | 4,096 | **none — empty response** |

At 40 strings the entire output budget went on thinking and the response
carried no text block at all. `createAnthropicProvider` throws
*"Anthropic response had no usable text content block"*, so it fails closed
rather than corrupting a locale file — but the run fails.

Two consequences beyond the obvious one:

- **No customer in this model could be onboarded.** The smallest scenario — a
  side project with 120 strings — already exceeded it.
- **`missingKeys` was computed and then dropped.** `handleTranslateBatch`
  returned it and the CLI printed it; `run-actions.ts`, the path a paying
  customer uses, never read it, so a locale that came back with three strings
  out of eight hundred was counted a success. A separate defect from the one
  above, and it would have outlived it.

### The fix, measured

| Configuration | Output tokens/string | Works at 40 | Works at 100 |
|---|---:|---|---|
| As configured (`max_tokens: 4096`) | 159 | no | no |
| `output_config: { effort: 'low' }` | **75** | yes | yes |
| `thinking: { type: 'disabled' }` | 100 | yes | — |
| `claude-haiku-4-5`, thinking disabled | 55 | yes | — |

`effort: low` is both the correctness fix and a 1.7× cost reduction — 2.1× on
output tokens, diluted by input, which `effort` does not change. All three
parts shipped together, because each is useless without the others:

**That figure was 56 and a 2.8× reduction until 2026-08-24.** Tuning escalation
to the owner's target added a `cue` field the model fills before answering, and
output per string rose to 73 — re-measured over the whole 414-entry corpus
rather than a hundred-string sample, which is also why it is more trustworthy
than the number it replaces. Every cost figure below moves with it; they are
generated from `packages/pricing`, not written here. The knock-on: a full
100-string chunk now emits ~7,300 output tokens, which pushed `max_tokens` from
8,192 to 16,384 — caught by a test, not by a failure.

1. `output_config: { effort: 'low' }` and `max_tokens` raised to 8,192, in
   `apps/api/src/router/anthropic.ts`.
2. Chunking at 100 strings per request, in `handleTranslateBatch` — one place
   rather than in each of the two callers, so the CLI and the web app cannot
   drift. Chunks run sequentially, and a chunk that fails does not discard the
   ones that succeeded.
3. `run-actions.ts` reads `missingKeys`, counts them, and a run that lost
   strings finishes `partial` rather than `succeeded`. The pull request body
   names the shortfall, because that is where the reviewer is.

**Verified end to end, twice**: 250 corpus strings through the real
`handleTranslateBatch` against the live API returned **250 translations, 0
missing** — in 84 and 88 seconds. That is the exact workload that previously
returned nothing at all.

A batch where *every* chunk fails still throws, so a provider outage remains a
502 rather than being reported to the customer as a partial run.

**This said the quality of `effort: low` was unevaluated. It has since been
measured** — see `docs/product/10-model-benchmark.md`, which runs all three
configurations over the 414-entry corpus through this same production path.

The short version: `effort: low` was not a quality trade. It answered 414 of
414 strings where default reasoning answered 90, and on the one locale both
completed it scored **80.55 chrF against 75.52**. Haiku is 2.2× cheaper and
close on quality, and is ruled out on reliability — invalid JSON in 2 of 6
repeated attempts, with no retry in the pipeline to absorb it.

One caveat survives and is the reason that document does not call the matter
closed: **escalation behaviour is still unmeasured.** Two escalations fired in
414 strings, which cannot distinguish one configuration from another, and the
corpus contains no strings that are ambiguous by construction. If lower effort
makes the model less willing to say "I don't know", that trades against
invariant 4 and no quality score would reveal it.

---

## What is measured, what is published, what is guessed

The tiers are the point. `packages/pricing/src/inputs.ts` keeps them apart so
that when a number turns out to be wrong, it is obvious whether the model was
wrong or the world was.

### Measured — this repository's real prompt, its real corpus

Obtained on 2026-08-21 with `POST /v1/messages/count_tokens` (free of charge)
and real `POST /v1/messages` calls, using the `INSTRUCTIONS` constant read from
`apps/api/src/translate/prompt.ts` and rows from
`packages/eval/src/corpus/data/entries.json`.

| Quantity | Value |
|---|---:|
| System prompt, billed once per request | 610 tokens |
| Input per string, with file path, component and surrounding code | 219 tokens |
| Output per string at `effort: low`, thinking included | 75 tokens |
| Output per string at the default effort, thinking included | 159 tokens |
| Extra output for an escalated string (question + alternatives) | +174 tokens |

Nothing here is derived from a characters-per-token ratio. One figure was
discarded and is recorded because an unwary re-measurement would land on it:
averaging over the whole corpus gives 138 input tokens per string, because half
its rows carry no `surroundingCode`. No real extraction produces that —
`packages/core` always emits six lines of context — and using it would
understate input by a third.

### Published — vendor rates

Anthropic list prices, read from the pricing table on 2026-10-10.
`claude-sonnet-5` is the configured default.

| | Input $/MTok | Output $/MTok |
|---|---:|---:|
| `claude-sonnet-5` | **2.00** | **10.00** |
| `claude-haiku-4-5` | 1.00 | 5.00 |

**There is one Sonnet 5 rate, and it does not expire.** This page used to model
$3.00/$15.00 and warn that the $2/$10 introductory rate expired on 2026-08-31,
because pricing against a rate due to lapse loses a third of the input margin
the day it does. The reasoning was sound and the outcome went the other way:
Anthropic made the introductory rate standard and cancelled the increase.
Footnote 3 of the pricing table states it — *"announced at launch as
introductory pricing through August 31, 2026, is now the standard price. The
previously scheduled increase to $3/$15 … will not occur."*

`introInput`/`introOutput` are gone from `inputs.ts` rather than kept at the
same values, and the "at introductory rates" lever is gone from the generated
report: a lever whose two sides are identical measures nothing. One check that
the repricing propagated correctly — the new baseline, $0.5444/month for the
typical customer, is to the digit what the old model computed as its
*introductory-rate* case.

The announcement date is deliberately not recorded anywhere in `inputs.ts`: the
official page carries none, and third-party coverage splits between 2026-08-10
and 2026-08-11, so a date would be the one unsourced number in a file whose
whole purpose is provenance.

**Haiku is now only half the price of Sonnet, not a third.** Sonnet fell and
Haiku did not, so the cheap-model lever below is worth materially less than it
was.

Prompt caching is a 1.25× write and a 0.1× read; the Batch API is 50%. Batch is
a poor fit — a run's output is a pull request somebody is waiting for.

### Fixed infrastructure

| | Monthly |
|---|---:|
| Supabase | $0 — free plan, established independently (leaked-password protection is Pro-only and is recorded as unavailable) |
| Vercel | **$20, not verified** |
| Storage | $0 — invariant 1 means no translations are stored; a run is a handful of rows |

The Vercel figure is the one soft number here, and it is modelled at Pro not
because consumption demands it but because **Hobby prohibits commercial use**.
The first paying customer requires Pro regardless of traffic. Treating it as $0
would understate the cost of being allowed to sell at all. `vercel teams ls`
names the team and not its plan; no read-only command in this session
established it.

At a $20 floor, **two typical customers at $19 cover all fixed cost.**

### Assumed — and what would settle each

| Assumption | Value | Settled by |
|---|---:|---|
| Share of strings escalated | **2%** kept deliberately — later measured at 0.48% over 414 strings and 5 locales | Strings that are ambiguous by construction; this corpus has none |
| Runs failed and re-run by hand | 10% | The `runs` table, once it has rows. Production has zero. |

**The escalation rate was a guess of 8% and observation puts it far lower.** Two
runs of 250 corpus strings through the real `handleTranslateBatch` into German
returned 250 translations each, with 2 and then 5 ambiguous — 0.8% and 2.0%.

The model uses the **higher** of the two. A cost model must not round in its own
favour, and two samples differing by 2.5× are a range rather than a number.

The full benchmark later put it lower still — **2 escalations in 414 strings
across five locales, 0.48%**. The model is deliberately **not** updated to that
figure. The corpus is drawn from open-source projects whose strings have already
survived one translation pass, so it under-represents ambiguity by construction;
a rate measured on it is a floor, not an estimate. Keeping 2% costs about 1% of
the modelled bill and removes a way to be wrong in the expensive direction.

It stays in this tier rather than moving up to *measured*, because one locale
and one corpus is not a rate. German forces a du/Sie choice that many languages
do not, and the corpus is drawn from open-source projects whose strings have
already been through a translation process once — both push the number around.
It is a measurement of one case being used as the estimate for all of them.
What has changed is that the model is no longer built on a figure known to be
wrong.

It turns out **not** to matter much either way, which is worth knowing before
anyone spends money establishing it properly. Swept from 2% to 20%, the typical
customer's steady state moves from $0.54 to $0.65 — a 19% range on a line that
is 3% of the cheapest plan. It is still worth measuring, because it drives how
often a human is interrupted, and that is a product question rather than a cost
one.

---

## Where the money actually goes

Three patterns make a customer expensive, and only the first is obvious.

**1. Onboarding, multiplicatively.** Cost scales with strings × locales ×
projects, and the first run pays for all of it at once because nothing is
translated yet. The worst realistic customer's first run is 10 projects ×
12,000 strings × 25 locales = 3,000,000 pairs. Every month after it is 3% of
that. This is the inverse of the usual SaaS shape and it is the whole reason to
push annual billing.

**2. Being connected while shipping nothing.** A run with nothing new to
translate still issues one request per locale, each paying the full 610-token
system prompt. At $0.00122 per locale per run it is invisible per run and it is
not invisible at scale: the worst realistic customer's 400 empty runs across 25
locales cost **$12.20 a month to translate nothing**. Prompt caching removes
most of this and is not switched on — no request sets `cache_control`.

**3. Locale count, which customers do not think of as usage.** Adding a
language is one dropdown and it multiplies every subsequent bill. A customer
going from 5 to 25 locales has quintupled their cost without adding a string.
Any cap expressed in strings rather than pairs will be wrong for exactly this
reason.

### The margin table

Gross margin on variable cost, at the three prices `08-critique.md` recorded as
untested hypotheses. Fixed infrastructure is excluded deliberately — it does
not vary per customer, and folding it in would make margin a function of how
many customers exist rather than of what one costs.

| Customer | Price | Steady state | Month one | Annual (10 months prepaid) |
|---|---:|---:|---:|---:|
| Low | $19 | 99.7% | 98.0% | 99.5% |
| **Typical** | **$19** | **97.1%** | **68.5%** | **93.7%** |
| Typical | $99 | 99.5% | 94.0% | 98.8% |
| **Heavy** | **$19** | **−26.7%** | **−884.7%** | **−137.8%** |
| **Heavy** | **$99** | **75.7%** | **−89.0%** | **54.4%** |
| Heavy | $399 | 94.0% | 53.1% | 88.7% |
| **Worst realistic** | **$399** | **−10.2%** | **−1,031.7%** | **−134.4%** |

Read three things off it:

- **$19 works for the typical customer** and is comfortable in steady state.
- **A heavy customer on $99 monthly loses $88 in month one and is net positive
  from month three.** Month one is −$88.08; every month after it contributes
  $74.94, so the cumulative figure crosses zero during month three. The same
  customer on annual prepay is 54% positive from day one. This is the single strongest argument for annual billing and it is now
  a number rather than an intuition.
- **The worst realistic customer loses money at every price offered.** It is
  not an abusive account — it is an ordinary enterprise trial with a large
  monorepo and CI wired up. Without a cap, one such signup costs more than
  twenty typical customers pay.

---

## Recommended MVP pricing

Set from the model, not from what feels generous. Every allowance is in
**string-locale pairs**, because that is the unit the cost is made of, and
every cap is a **compute guard rather than a value meter** — which is what
keeps invariant 3 intact.

| | Free | Starter | Team | Scale |
|---|---|---|---|---|
| Monthly | $0 | **$19** | **$99** | **$399** |
| Annual (2 months free) | — | $190 | $990 | $3,990 |
| Projects | 1 | 1 | 5 | 20 |
| Locales | 3 | 6 | 15 | unlimited |
| One-time initial import | 1,000 pairs | 6,000 | 40,000 | 150,000 |
| Pairs per month after | 300 | 3,000 | 15,000 | 60,000 |
| Daily ceiling | 300 | 1,000 | 5,000 | 20,000 |
| Worst-case COGS/month | $0.37 | $3.67 | $18.34 | $73.37 |
| Gross margin at the cap | — | **80.7%** | **81.5%** | **81.6%** |

The structure follows three decisions:

**The initial import is a separate allowance from the monthly one.** It is the
only place the multiplicative cost lands, it happens once, and folding it into
a monthly number forces the monthly number to be either too small to onboard
anyone or too large to be safe. A typical customer's import is 4,000 pairs and
fits in Starter; a heavy customer's is 120,000 and requires Scale, which is the
correct answer.

**Annual is offered at two months free and should be pushed hard.** It is not a
discount, it is what converts the riskiest cohort into the safest: twelve
months amortises an import that a monthly plan pays for in week one. §C3
recommended this without numbers; the numbers are in the table above.

**The daily ceiling is roughly a tenth of the monthly allowance.** It exists so
that no single day can consume a month, which is what bounds the adversarial
case. At Scale's 20,000 pairs/day the worst possible month is $734 against
$399 — so Scale additionally needs the monthly cap to bind, and it does.

### On overage: there should not be any

The brief asked where overage applies. The answer is **nowhere**, and the
reason is invariant 3: *"Aucune facturation au mot/caractère/relecteur.
Abonnement fixe uniquement."* Billing per pair beyond a cap is billing per
string, which is the pricing model this product exists to replace. A customer
who has to watch a counter has the problem they left Phrase to escape.

What happens at the cap instead: **the run stops and says so.** The interface
names what was reached, what it would take to continue, and offers the next
tier. Work already queued is not silently dropped and nothing is charged
without the customer choosing it.

If true overage is wanted, it requires amending invariant 3, and that is a
positioning decision rather than a pricing one. It is not mine to make and I
have not modelled it.

### Cheap-model routing is worth $0.61 per 1,000 pairs, and is worth less than it was

Haiku 4.5 costs $0.61 per 1,000 pairs against Sonnet 5's $1.22 — a halving that
would take Scale's worst-case COGS from $73.37 to $36.68. `08-critique.md` §C3
called cheap-model routing "load-bearing architecture"; on these numbers it is
load-bearing for less than it used to be.

**The lever shrank without anyone touching it.** Sonnet 5 fell to $2/$10 and
Haiku 4.5 stayed at $1/$5, so a saving that was two thirds is now one half, and
the absolute saving at Scale fell from $61.97 to $36.69 a month. A quality risk
worth taking for a two-thirds cut is a different proposition at a half — which
is an argument for leaving it unmeasured a while longer, not for taking it.

It is also unmeasured. `packages/eval` has a 414-string corpus and deterministic
placeholder/ICU checks in CI, and neither has been run against Haiku for this
task. Routing to a cheaper model on the strength of its price is exactly the
decision the harness was built to prevent.

---

## What is still unknown

Two things, both cheap, both blocking a published price.

**1. Whether `effort: low` costs accuracy.** It is the recommended
configuration and a 1.7× saving on cost (2.1× on output tokens alone). Running the existing eval harness against both
settings answers it in one afternoon and one batch of inference.

**2. Willingness to pay.** This model says whether a price survives its costs.
It says nothing about whether anyone will pay it, and §C3's finding that the
personas are inventions with zero primary research is unchanged. $19/$99/$399
remain hypotheses; what has changed is that they are no longer *unpriced*
hypotheses.

Neither is a reason to delay the caps. The pair allowances above are sound
whatever the price turns out to be, because they are derived from cost.

---

## Addendum, 2026-10-03: the guardrail is a different cost, and it is measured

Everything above prices the **legacy pipeline** — extract from source,
translate, open a pull request. It is still correct for that path. It is not
the path the product now leads with, and the new one has a different cost
shape, measured here rather than extrapolated.

The guardrail is `PR → analyse → GitHub Check → safe correction → corrective
PR`. Two facts about it decide the economics, and both come from reading the
code rather than from a model:

**The Check costs nothing.** `packages/core/src/i18n` reads the catalogues and
`packages/eval/src/audit` judges them. No model is called on that path, so a
repository that only ever gets checks — which is every repository whose pull
requests touch no catalogue, and every delivery whose findings are all
`placeholder-mismatch` — costs zero inference. This is not a rounding claim;
there is no call site.

**The correction sends no context.** `translateBatch` in
`apps/web/src/lib/i18n/correct-github.ts` sends `filePath: ''`,
`componentName: null`, `surroundingCode: ''`, because a catalogue entry
genuinely has none of those. Every figure above was measured on strings that
carried all three. The prompt is therefore smaller and the per-string cost is
lower — and the fixed part of a call is a far larger share of it.

### Measured, 2026-10-03

`apps/api/eval/correction-cost.ts`, against `claude-sonnet-5` at the
production defaults (`effort: low`, 8192 max tokens), sending the
`localize-infra-fixture-i18next` English catalogue in the exact shape the
correction sends, into `de`:

| Strings in the call | Input | Output | Thinking | Cost | Per string |
|---|---|---|---|---|---|
| 1 | 1,627 | 44 | 0 | **$0.003694** | $0.003694 |
| 4 | 1,808 | 180 | 0 | **$0.005416** | $0.001354 |
| 14 | 2,438 | 1,372 | 267 | **$0.018596** | $0.001328 |

The **token counts are the measurement**; the costs are those counts at the
current published rate. They read $0.005541 / $0.008124 / $0.027894 until
2026-10-10, when the rate fell from $3/$15 to $2/$10. Nothing was re-run — the
consumption did not change, only its price.

Three points, not one, because the cost is **not** proportional to the
strings. Input is linear and output is not:

```
input  = 1,563 + 62 × strings        (fits all three points to within 0.3%)
output = 44 at n=1, 45/string at n=4, 98/string at n=14

cost   = $0.003126            fixed, paid once per call
       + $0.000124 × strings  input
       + $0.00044–$0.00098 × strings   output, depending on the strings
```

The fixed part is ~1,563 input tokens of system prompt and instructions, paid
once per call whatever the call carries. **It is 85% of a one-string call.**
The output spread is content: a plural or a placeholder costs more than
`"Home"`, and the 14-string call spent 267 tokens thinking where the two
smaller ones spent none.

### The number that matters is not the marginal one

**One model call per locale.** `buildCorrection` loops the locales and calls
`/v1/translate` once each, so the fixed cost is paid **per language**, not per
correction. And the guardrail's characteristic correction is *one key that
somebody forgot to translate*:

| Correction | Calls | Cost | Per pair |
|---|---|---|---|
| 1 key × 6 locales (the real fixture case) | 6 | **$0.0222** | $0.00369 |
| 5 keys × 6 locales | 6 | **$0.0360** | $0.00120 |
| 40 keys × 1 locale (the ceiling, cheapest shape) | 1 | **$0.0473** | $0.00118 |
| 1 key × 40 locales (the ceiling, worst shape) | 40 | **$0.1477** | $0.00369 |

Rows one and four are measured directly — both are calls of one string. Rows
two and three extrapolate the per-string output rate from the 4- and
14-string measurements, and are marked as estimates for that reason.

**Row four was labelled "40 keys × 40 locales" until 2026-10-10 and that was
wrong**: 1,600 units cannot pass a 40-unit ceiling, and the row's own note said
it was a call of one string. It is one key across forty locales — the shape that
pays the fixed cost forty times.

So the guardrail's unit cost is **$0.0037 per string-locale pair** against the
legacy path's $0.0012 — **3.0× the figure above** — because its corrections are
small and small corrections are all prompt. The legacy figure is approached only
by a correction big enough to amortise its own prompt, and
`MAX_CORRECTION_UNITS` is 40.

### Worst case, bounded by the guardrails that already exist

`MAX_CORRECTION_UNITS = 40` caps one delivery. `MAX_ATTEMPTS = 3` caps the
retries, and a retried chunk is a paid call. `api_limits()` caps the day:

| Bound | Value | Where |
|---|---|---|
| Units per correction | 40 | `MAX_CORRECTION_UNITS` |
| Model calls per locale | 3 | `MAX_ATTEMPTS` |
| Pull requests per day | 50 | `api_limits().prs_per_day` |
| String-locale pairs per day | 5,000 | `api_limits().strings_per_day` |

- **Most expensive single correction**: 40 locales × 3 attempts × $0.0037 =
  **$0.443**, and it delivers nothing — every attempt failed. The tally still
  records it, which is the point of counting requests rather than results.
- **Most expensive successful correction**: 40 locales × $0.0037 = **$0.148**.
- **Most expensive day for one workspace**: the pull-request ceiling binds
  first, not the string ceiling. 50 corrections × $0.148 = **$7.39/day**, so
  **$222/month** for a workspace that saturates its ceiling every day of the
  month. The 5,000-pair ceiling is never reached on that path: 50 × 40 = 2,000.

That $222 is the number a plan has to survive, and it is an abuse ceiling, not
a forecast. A real repository producing 50 maximal corrections a day every day
is not a customer, it is an incident.

**At the production per-call figure below rather than the harness one, the same
ceiling is $273/month.** The harness measured German only; production measured
six mixed locales and cost 23% more per call. The higher number is the one to
plan against, and it is the one with a real workspace behind it.

### A plausible workspace

A team merging 40 pull requests a month, a fifth of which forget a translation,
into 6 languages, one or two keys each:

```
8 corrections × 6 calls × $0.004544  =  $0.22 / month
```

The per-call figure is the production measurement below, not the harness: it is
the only one taken over a realistic mixture of locales. Checks on the other 32
pull requests cost nothing. **Under $0.25 a month in inference.** The legacy
pipeline's $0.54 typical figure above still applies to whoever uses that path,
and the two add rather than replace.

### Reconciled against production, 2026-10-09

**This section said no production correction had been recorded. It has been.**
One controlled correction was run end to end and read back out of the
workspace's row.

`apps/api` was the missing half and it was not obvious: the deployed commit was
`4a6f347`, which predates #143, so `/v1/translate` returned no `usage` field at
all. `readUsage` returned null, `addModelUsage` added nothing, and
`recordModelUsage` returned at `if (input.usage.requests <= 0) return` without
writing a row. The database and `apps/web` had been ready since 2026-10-03;
because `apps/api` does not follow Git, merging #143 did not deploy it. A
correction run before that deploy would have spent money and written zeros —
indistinguishable from the four existing rows.

Deployed, then measured. `localize-infra-fixture-i18next` #20 added one English
key (`errors.rateLimited`) absent from all six target locales; one
`pull_request.opened` delivery, no retries, corrective pull request #21 in 31
seconds.

| From `api_usage_daily`, 2026-10-09 | |
|---|---:|
| `model_requests` | **6** |
| `input_tokens` | **9,847** |
| `output_tokens` | **757** |
| `thinking_tokens` | 0 |
| Derived cost at $2/$10 | **$0.027264** |

**The consumption is measured; the dollar figure is derived.** It is those token
counts times the published rate, computed in `build.ts` rather than written
here, so it moves when either moves. **No provider invoice has been compared to
it**, and until one is, this settles what the product consumes rather than what
it is billed.

**The input model is validated. The output model is not.**

| | Harness × 6 | Production | Δ |
|---|---:|---:|---:|
| input tokens | 9,762 | 9,847 | **+0.87%** |
| output tokens | 264 | 757 | **+186.7%** |
| cost | $0.022164 | $0.027264 | **+23.0%** |

Input per call was 1,641 against 1,625 predicted by `1,563 + 62 × strings` —
**within 1%**. Output was 2.9× the harness, and **96.7% of the cost overrun is
output**. Two causes, and this measurement cannot separate them: the harness
translated German only, while this included `ar` and `ja`, which tokenise more
densely; and two of the six were refused as ambiguous, each emitting the
model's question as extra output. `api_usage_daily` aggregates per
workspace-day with no per-locale column.

**One observation over a mixture does not establish a cost per pair**, and the
generated report says so in a field (`establishesCostPerPair: false`) rather
than in prose that could be skimmed. Several corrections over known locale sets
would settle it.

Two behaviours confirmed rather than assumed: **6 charged, 4 applied** — the
workspace is billed for what is sent, not what survives the re-audit — and
`prs_opened` incremented *and* a pull request opened, unlike two earlier
observations where it incremented for nothing.

So: the **cost** is measured, the **attribution** is tested, the
**consumption** is now reconciled against production, and what remains undone
is the comparison against an **invoice**.

### Still open

- **The selected figures are tested. The document as a whole is not.**
  `packages/pricing/src/report/document.test.ts`, added in #153, binds **23**
  figures to the path they come from in `cost-model.json`: the four
  per-1,000-pair costs, the nine customer-shape costs, the four plan COGS and
  three margins at cap, and the three production-observation figures. A failure
  names the figure, its JSON path and the command that regenerates it, so the
  2026-08-24 drift would now be a red test rather than six quiet weeks. Four
  further assertions hold the honesty clauses rather than the arithmetic: the
  published rate, the adversarial run, `reconciledAgainstInvoice` staying false
  with the page still saying so, and the single-observation caveat surviving.

  **There is still no generator, and the coverage is partial on purpose.** Any
  number outside those 23 can still drift — the token counts in the measured
  tables, the ratios quoted mid-sentence, the arithmetic in the worked
  examples. Widening it means restructuring this document into data, which is
  the generator the test was chosen over: the value here is the argument, and
  the drift happened in figures quoted inside sentences that a table generator
  would have left unguarded either way.
- **No invoice comparison, and this is the one that matters most.** Every
  dollar figure above is measured consumption multiplied by a published rate.
  `reconciledAgainstInvoice` is false in the artefact and nothing has been set
  against a provider bill, so the model says what the product *consumes*, not
  what it is *billed*.
- **One observation is not a rate.** `establishesCostPerPair` is false. Several
  corrections across known locale sets are needed before a per-pair cost can be
  claimed from production, and there is still **no per-locale attribution** —
  `api_usage_daily` has no such column, so the output variance cannot be split
  between script density and ambiguity refusals.
