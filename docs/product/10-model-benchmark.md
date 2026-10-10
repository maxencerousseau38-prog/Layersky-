# Which model and settings should be the default

Date: 2026-08-22
Status: **the benchmark ran.** Quality is compared, not assumed. No production
default has been changed by this document.

`docs/product/09-unit-economics.md` recommended `effort: low` on cost and
correctness grounds and said, twice, that its effect on **quality** was
unmeasured. This measures it.

Everything below comes from `apps/api/eval/run.ts`, which drives the
**production** path — the prompt in `src/translate/prompt.ts`, the batching and
`missingKeys` accounting in `handleTranslateBatch`, the parser in
`parse-response.ts` — over the existing 414-entry corpus in `packages/eval`,
scored with that package's existing deterministic checks. Results are committed
at `apps/api/eval/results/`.

---

## The recommendation, first

**Keep `claude-sonnet-5` with `effort: low` as the default.** It was the only
configuration that answered every string, and on the one locale where all three
completed it also produced the *best* quality of the three. The cheaper option
was not a quality trade — it was a straight win.

That is the opposite of what the cost model assumed it was buying, and it is
worth stating plainly: `effort: low` was adopted in the P0 fix because it made
the pipeline work, with an explicit note that it might cost accuracy. It does
not.

| | Sonnet 5, `effort: low` | Sonnet 5, default reasoning | Haiku 4.5 |
|---|---:|---:|---:|
| Strings answered | **414 / 414** | 90 / 414 | 323 / 414 |
| Locales completed | **5 of 5** | 1 of 5 | 3 of 5 |
| chrF, Spanish¹ | **80.55** | 75.52 | 79.70 |
| Exact match, Spanish¹ | **40.0%** | 27.8% | 40.0% |
| Placeholders preserved | 19 / 19 | 2 / 2 | 13 / 13 |
| Glossary violations | **0** | 0 | 0 |
| Escalations | 2 | 2 | **0** |
| Latency per request | 42.7 s | 68.6 s | **34.5 s** |
| Cost per 1,000 pairs | $0.98 | $1.33 | **$0.44** |

**Repriced 2026-10-10, and only two of those three columns moved.** Anthropic
made Sonnet 5's $2/$10 introductory rate permanent and cancelled the rise to
$3/$15; Haiku 4.5 stayed at $1/$5. The Sonnet columns read $1.47 and $1.99
until then. **Nothing was re-run** — token consumption is the measurement and
did not change; only its price did. Input and output both fell by exactly one
third, so every Sonnet dollar figure in this document scales by two thirds, for
any mix of the two.

The consequence worth noticing: **Sonnet is now 2.2× Haiku's cost, not 3.3×.**
The cheap-model argument got weaker without anyone measuring anything.

¹ Spanish is the only locale all three configurations answered completely.
Comparing a five-locale average against a one-locale average would flatter
whichever config failed on the hard locales, so the like-for-like column is the
one to read.

---

## What each configuration did

### Sonnet 5, `effort: low` — the proposed default

Answered all 414 strings across all five locales, in five requests, with **65
thinking tokens in total**. Every one of the eleven requests it made across the
comparison and robustness runs returned parseable output.

### Sonnet 5, default reasoning — fails, and is also worse

Answered one locale of five, and **zero of six** attempts when the German batch
was repeated. The failures are all the same shape: the model spends its output
budget reasoning and the JSON is cut off mid-string.

Diagnosed directly on German at 90 strings: `stop_reason: max_tokens`, 8,192
output tokens of which **5,401 were thinking**, response truncated at position
4,456. At 45 strings the same configuration succeeds — so the failure is the
batch size against the reasoning overhead, not a hard limit.

`09-unit-economics.md` reported this configuration failing at `max_tokens:
4096`. It fails at 8,192 too. It would need a chunk size around 45, which
roughly doubles the number of requests *and* costs 36% more per pair.

And it is not buying quality with that: on Spanish it scored **75.52 chrF
against 80.55**, with exact-match agreement of 27.8% against 40.0%. More
reasoning produced worse translations here, not better ones.

### Haiku 4.5 — cheap, close on quality, and not reliable enough

Three locales of five, and the arithmetic is the interesting part. Its Spanish
quality is within a point of Sonnet's (79.70 against 80.55) and its Brazilian
Portuguese is *better* (83.3 against 81.4). Its Japanese is 8.3 points worse
(65.1 against 73.4). It preserved every placeholder and violated no glossary
term. It is 2.2× cheaper and 20% faster.

What rules it out is **unparseable output**. German failed in the comparison run and
again on one of five repeats — with `stop_reason: end_turn`, so the model
finished and emitted invalid JSON rather than running out of room. See the
robustness table below.

There is **no retry** in the pipeline. One malformed response is one locale that
produces nothing, in a run that still opens a pull request for the locales that
worked.

---

## Reliability, measured by repetition

`apps/api/eval/robustness.ts` sends the same 90-string German batch five times
per configuration through the production path. Committed at
`apps/api/eval/results/robustness.json`.

| Configuration | Complete attempts | Failure mode |
|---|---:|---|
| Sonnet 5, `effort: low` | **6 / 6** | — |
| Sonnet 5, default reasoning | **0 / 6** | Output truncated mid-JSON; once, no text block at all |
| Haiku 4.5 | **4 / 6** | Invalid JSON at `end_turn` — finished and emitted something unparseable |

Six attempts: the five repeats plus the one in the comparison run. They cannot
establish a failure rate. What they can establish is whether a failure recurs,
and it does — for Haiku intermittently, for default reasoning every single time.

Default reasoning failing 6 of 6 at 90 strings settles what the comparison run
only suggested: its one success there was the locale that happened to be short
enough, not a configuration that mostly works.

---

## After the retry

The benchmark's one architectural finding was that a malformed response cost
every string in its chunk, with no second attempt. `handleTranslateBatch` now
retries a chunk up to three times with exponential backoff and full jitter,
asking each time only for the keys still missing.

The same 414-entry benchmark was then rerun, unchanged, through the same
production path. Nothing about the model or the effort setting was changed.

| | Answered | Missing | chrF | Requests | Latency | Cost | $/1k pairs |
|---|---:|---:|---:|---:|---:|---:|---:|
| **`effort: low`** before | 414/414 | 0 | 75.49 | 5 | 214 s | $0.405 | $0.98 |
| **`effort: low`** after | 414/414 | 0 | 75.23 | 5 | 214 s | $0.407 | $0.98 |
| **Haiku 4.5** before | 323/414 | 91 | 73.03 | 5 | 173 s | $0.181 | $0.44 |
| **Haiku 4.5** after | **414/414** | **0** | 73.84 | 6 | 181 s | $0.183 | $0.44 |
| **default reasoning** before | 90/414 | 324 | 75.52 | 5 | 343 s | $0.551 | $1.33 |
| **default reasoning** after | **0/414** | **414** | — | 15 | 1,045 s | $1.705 | $4.12 |

Sonnet rows repriced at $2/$10; the Haiku rows are unchanged because its rate
is. Answered counts, chrF, requests and latency are measurements and are
untouched.

Three things to read off it, and only the first is good news.

**The retry does exactly what it was added for.** Haiku went from losing a whole
locale to losing nothing: 91 strings recovered by **one** extra request, for
$0.002 and eight seconds. That is the intermittent-fault case, and it is the one
the pipeline is actually exposed to.

**It costs the recommended configuration nothing.** `effort: low` needed no
retries in either run — five requests both times, the same $0.98 per 1,000
pairs. The insurance is free when the tail does not fire.

**It made the broken configuration worse, and that is not hidden.** Default
reasoning went from 90 answered to **zero**, at three times the cost and three
times the wall-clock. Retrying a configuration that fails *systematically*
recovers nothing and pays three times for the privilege — its 90 answered
strings in the first run were one locale that happened to fit, and this run it
did not. The bounded limit is what keeps that from being unbounded: it stopped
at three attempts per chunk, not at infinity.

That last row is the argument against treating a retry as a substitute for a
correct configuration. It is insurance against a tail, not a repair for a model
that cannot answer.

### The retry does not rescue Haiku, and that matters

The robustness probe was rerun too — the same 90-string German batch, five times
per configuration, now with retries in play.

| Configuration | Complete attempts before | after |
|---|---:|---:|
| Sonnet 5, `effort: low` | 5 / 5 | **5 / 5** |
| Sonnet 5, default reasoning | 0 / 5 | **0 / 5** |
| Haiku 4.5 | 4 / 5 | **3 / 5** |

Haiku's two failures both came back with `answered: 0` — the whole batch lost
after *three* attempts, each with the same
`Expected ',' or '}' after property value` error. Retrying the same input
produced the same malformed output.

That is the useful finding, and it cuts against the full-benchmark row above.
Haiku's failures on this batch are **input-dependent, not random**: something
about these 90 German strings reliably breaks its JSON, and a retry re-sends the
same prompt into the same failure. Its 414/414 in the comparison run was a
luckier draw, not the retry reliably working.

The before/after numbers here — 4/5 against 3/5, five attempts each — are far
too few to claim the retry made anything worse. What they do establish is that
it did not make Haiku dependable, which is what would have been needed to
reconsider it.

### On the numbers moving

`effort: low` scored 75.49 and then 75.23 on identical inputs with an identical
configuration — a spread of **0.26 chrF from resampling alone**. That is the
first measurement of run-to-run variance this benchmark has, and it should be
read against the gaps it is being used to judge: the Sonnet-to-Haiku gap of
about 1.4 chrF is roughly five times it, and the like-for-like Spanish gap to
default reasoning was five points.

One observation of variance is not an error bar. It is enough to say that
differences below half a point should not be argued about.

Haiku's chrF moved from 73.03 to 73.84 for a different reason and the two are
**not** comparable: the earlier figure excluded German entirely, because German
was the locale it lost. Its placeholder denominator moving from 13 to 19 is the
same effect — those entries only exist in the scored set now that the locale
came back.

---

## What this benchmark could not measure

Stated here rather than buried, because three of the things a reader would most
want are not in it.

**Human preference — never run.** `08-critique.md` §C2 recorded that the human
evaluation was never carried out and that no evaluators were ever recruited.
That is still true. chrF and exact match are **reference-agreement proxies**: a
different but perfectly good translation scores as a miss, and a clumsy one
sharing characters with the reference scores well. Their *ordering* between
configurations on the same references is informative; their absolute level is
not, and neither is a substitute for asking a speaker of the language.

**ICU messages and plural categories — no applicable input.** The corpus
contains **zero** ICU messages, so `validateIcu` and `pluralCategoriesCorrect`
had nothing to run against. This is exactly the "No data" case CLAUDE.md
already records for `/benchmarks`. Any claim about how these models handle ICU
plurals would be invented.

**Placeholder preservation — 19 entries.** All 19 survived in every
configuration, which is a real result and a thin one: one failure would have
moved the figure five percentage points. It supports "no configuration is
obviously broken on placeholders" and not much more.

**Escalation behaviour — underpowered, and the one open risk.** Two escalations
fired out of 414 for `effort: low`, two out of 90 for default reasoning, zero
out of 323 for Haiku. The ones that fired were the right kind — *Digest*,
*Prompt*, *Architect*, *Sharing*, all genuine two-sense words. But two events
cannot distinguish 0.48% from 0%, and the corpus was assembled from
already-translated open-source projects rather than to contain ambiguity.

The rate difference that *would* matter if it survived a real test is that
default reasoning escalated at 2.2% against `effort: low`'s 0.48%. If lowering
effort makes the model less willing to say "I don't know", that trades against
invariant 4 — the agent raises ambiguities rather than guessing — and no amount
of chrF would show it. **This is the one place where `effort: low` might be
costing something, and this benchmark cannot tell.**

Settling it needs a corpus of strings that are ambiguous *by construction*,
with the expected escalation recorded — roughly 50 deliberately two-sense
strings per locale, which does not exist and would have to be written.

**Single-run quality.** Each configuration translated each locale once. Model
output varies between calls; the quality figures carry no error bars.

---

## Should the architecture change?

Mostly no. Three things came out of the run.

**Keep the chunking, and keep it where it is.** 100 strings per request is
comfortable for the recommended configuration — 5,727 output tokens against an
8,192 ceiling on the largest batch — and it is the size that makes the
one-request-per-locale shape work. Chunking in `handleTranslateBatch` rather
than in each caller is what let this benchmark drive the real path at all.

**Add a retry. Done — see "After the retry" above.** It was the one change the
evidence demanded, and it is not model-specific: a malformed or truncated
response lost every string in its chunk with no second attempt. It recovered 91
strings for Haiku at a cost of $0.002 and eight seconds, and cost the
recommended configuration nothing at all.

Three properties were worth designing for rather than reaching for the obvious
loop:

- **Bounded.** Three attempts. A model that reliably cannot answer a chunk will
  not start on the fourth, and the default-reasoning row above is what
  unbounded retrying against a systematic failure would have looked like with
  no ceiling.
- **Only the gap is re-sent.** A retry asks about the keys still missing, never
  the whole chunk. That is what makes a partial answer cheap to complete, and
  it is also why a key can never be answered twice — the second attempt does
  not ask about the accepted half.
- **A key nobody requested is dropped.** `parseTranslationResponse` validates
  shape, not membership. Without this a hallucinated key reaches
  `record_run_translations` as a proposal for a string that is not in the
  repository.

**Consider asking for structured output.** Every failure in this benchmark was
a JSON parsing failure rather than a translation failure. The API can constrain
the response format instead of asking for it in prose. That is a larger change
and it is not needed for the MVP, but it removes the entire failure class rather
than retrying it.

---

## Answers to the questions this was run to settle

**Which model and config should be the MVP default?**
`claude-sonnet-5` with `output_config: { effort: 'low' }` and
`max_tokens: 8192` — which is what `createAnthropicProvider` already sends. No
change to production defaults is required, and this document does not make one.

**Is `effort: low` acceptable?**
Yes, on the evidence available, and it is better than the alternative rather
than merely cheaper: complete where default reasoning is not, and higher
quality where they can be compared. The reservation is escalation behaviour,
which is unmeasured and worth measuring before this is called settled.

**Is Haiku acceptable for any tier or stage?**
Not as the default, and not yet anywhere. This answer was written before the
retry existed, expecting the retry to be what changed it. **It did not.**

The quality is close enough to be tempting — within a point on Spanish, better
on Portuguese, 2.2× cheaper. Three things stand against it:

- **Its failures survive retrying.** Two of five attempts on the same German
  batch lost all 90 strings after three tries each, every time with the same
  malformed-JSON error. The failure is input-dependent, so a second attempt is a
  second sample of the same broken output.
- **It never escalated once** in 414 strings, against Sonnet's 2 to 3. Two
  events cannot prove a difference, but invariant 4 is the product's promise and
  Haiku has produced no evidence it honours it.
- **8.3 chrF behind on Japanese**, while ahead on Portuguese — so any adoption
  is per-locale, not global.

Where it would become reasonable: a free tier, on locales where it has been
shown to hold up, **after** the escalation question is settled and after the
JSON failure is addressed at the source rather than retried around — structured
output is the obvious lever. Routing by locale is a real option the data
supports. This document does not recommend acting on it.

**Expected cost per 1,000 translation pairs**
**$0.98 measured**, against **$1.22 modelled** in `09-unit-economics.md` — the
model is **25% conservative**. Haiku measured $0.44, unchanged.

This line read "$1.47 measured, against $1.55 modelled … 5% conservative" and
**the 5% was wrong for seven weeks**, independently of the repricing. It
compared the benchmark against the 1.5492 the model carried on 2026-08-22; the
escalation tuning raised it to 1.8342 on 2026-08-24 and this sentence was never
revisited. The gap was 25% before the reprice and is 25% after it — both rates
fell by the same third, so the ratio is untouched. The direction is still the
safe one; the magnitude was understated five-fold.

**Expected quality trade-off**
None against default reasoning; it is a gain. Against Haiku, Sonnet buys
reliability and Japanese quality for **2.2×** the token cost — it was 3.3×
before Sonnet was repriced and Haiku was not — which at $0.98 per 1,000 pairs
is still a rounding error against every plan in `09-unit-economics.md`.

The premium narrowed by a third without any new measurement, so the trade is
more favourable to Sonnet than when this was written, not less.

**Should the current architecture be kept?**
Yes, plus a retry. See above.

### A separate lead, not a recommendation: Claude Sonnet 5.5

**Nothing in production changes.** `API_ANTHROPIC_MODEL` is unset and
`apps/api/src/index.ts` still defaults to `claude-sonnet-5`. This is recorded
as a benchmark lead so it is not rediscovered later.

Read from the same Anthropic pricing table on 2026-10-10, `claude-sonnet-5.5`
is listed at **$2 / MTok input and $10 / MTok output — identical to Sonnet 5**,
with cheaper cache hits ($0.10 against $0.20, 0.05× base rather than 0.1×).

That makes it the one candidate whose cost case needs no argument: at the same
price, any quality or reliability gain is free, and a loss is the only way it
could be the wrong choice. Which is precisely why it must go through the
harness rather than be adopted on a price table — the same reasoning that keeps
Haiku unadopted at half the cost.

What is **not** known and would have to be measured: chrF per locale, whether
it answers 414/414 on this corpus, escalation behaviour against invariant 4,
and JSON validity across repeated attempts. The run costs one batch of
inference against the existing 414-entry corpus.

The cache-hit difference is worth a line of its own, because
`09-unit-economics.md` records prompt caching as the largest *available* saving
that is not taken — no request sets `cache_control`. If caching is ever
switched on, Sonnet 5.5 halves the cost of the cached half relative to Sonnet 5.
Those two decisions are therefore cheaper to take together than apart.
