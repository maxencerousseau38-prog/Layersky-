import { SectionHeading } from '@/components/landing/section-heading';
import { cn } from '@localize-infra/ui';
import { Check, Circle, Minus } from 'lucide-react';

/**
 * The honesty section, as a status board.
 *
 * Most pre-launch sites present the roadmap as though it shipped. This one
 * states plainly what runs today and what does not — which is both the correct
 * thing to do and, given the product's positioning on not guessing, the only
 * consistent thing to do.
 *
 * The previous version split that into three parallel columns, which asked the
 * reader to scan sideways to answer "is X built?" — the one question this
 * section exists for. One continuous board answers it by reading down.
 *
 * **Only what works carries colour.** Jade marks shipped capability; everything
 * unshipped is graphite. That is the palette rule applied to the product's own
 * maturity, and it replaces an Iris that had leaked onto "in development" —
 * Iris means your judgement is required, and it is not spent on roadmap state.
 *
 * **"In development" is gone because nothing was in development.** Four rows
 * wore it. One — hosted accounts and projects — had shipped. One — the review
 * queue — was built and deployed but has never handled a real question. Three —
 * the SDK, the non-developer surface, billing — had no code and no commits.
 * "In development" told a reader work was under way on all four. The states
 * below say which of those each one is.
 */
type State = 'working' | 'unproven' | 'notStarted' | 'unmeasured';

const STATE: Record<
  State,
  { label: string; icon: typeof Check; mark: string; text: string }
> = {
  working: {
    label: 'Working',
    icon: Check,
    mark: 'border-confident bg-confident text-inverse',
    text: 'text-primary',
  },
  unproven: {
    label: 'Built, not yet used',
    icon: Circle,
    mark: 'border-subtle bg-raised text-tertiary',
    text: 'text-secondary',
  },
  notStarted: {
    label: 'Not started',
    icon: Minus,
    mark: 'border-subtle bg-raised text-tertiary',
    text: 'text-secondary',
  },
  unmeasured: {
    label: 'Not measured',
    icon: Minus,
    mark: 'border-subtle bg-raised text-tertiary',
    text: 'text-secondary',
  },
};

const ITEMS: Array<{ name: string; state: State; note?: string }> = [
  {
    name: 'Framework detection',
    state: 'working',
    note: 'Next.js, Vite + React, React Native',
  },
  {
    name: 'Hardcoded string extraction',
    state: 'working',
    note: 'AST-based, not a regular expression',
  },
  { name: 'Translation into any target language', state: 'working' },
  {
    /*
     * "never overwrites your edits" was too broad, and the gap is a way to
     * lose work rather than a wording quibble.
     *
     * `mergeLocaleFile` rebuilds each file from the freshly extracted
     * catalogue, so a value you edited survives — and a *key* extraction no
     * longer produces does not. `init` refuses a run that would drop keys, but
     * it compares `en.json` alone, so a hand-written entry that exists only in
     * a target file is outside the guard. Probed against the published
     * package, not read off the source.
     *
     * The row still reads `working`, because the capability works and is the
     * reason to trust a re-run. What changed is that the claim now ends where
     * the behaviour does; /docs carries the rest.
     */
    name: 'Merge that keeps your edits',
    state: 'working',
    note: 'A translation you changed by hand is kept, for every key extraction still finds',
  },
  {
    name: 'Per-language failure isolation',
    state: 'working',
    note: 'One failure never aborts the run',
  },
  {
    name: 'Branch, commit and pull request',
    state: 'working',
    note: 'Through a GitHub App you install',
  },
  {
    /*
     * Missing from a board whose whole job is naming what works.
     *
     * Every row above describes what the pipeline does; none said you can
     * install it. The package has been on npm since 2026-08-28 and the
     * personal-token path since 0.3.0 — `CLI_PUBLISHED_TO_NPM` and
     * `CLI_PERSONAL_TOKENS_LIVE` both read true, and the production database
     * holds tokens that were issued and used. A capability that shipped and is
     * absent from the status board is the same omission as a roadmap item
     * described in the present tense, pointing the other way.
     */
    name: 'Install and run it from your terminal',
    state: 'working',
    note: 'npx @localize-infra/cli, against the hosted API with a personal token or one you run yourself',
  },
  {
    name: 'Hosted app: accounts, workspaces, projects, runs',
    state: 'working',
    note: 'Early access, sign-up open. Private repositories are not self-serve yet',
  },
  {
    name: 'Answering unresolved strings before the pull request',
    state: 'unproven',
    note: 'In the hosted app. No real run has raised a question yet',
  },
  {
    /*
     * Named here because the section promises it is.
     *
     * "The rest are named here rather than implied elsewhere" is the sentence
     * beside this list, and two not-started capabilities were named only on
     * /roadmap: placeholder-aware extraction and visual context capture. A
     * reader who trusts this board to be complete would have left without the
     * first one, which /roadmap calls the item everything else waits behind —
     * "no broader quality claim will be made until it is fixed".
     *
     * Verified rather than copied across: `packages/core/src/extract` contains
     * no placeholder handling, and /docs states two sections apart that strings
     * inside JSX expressions and template literals are not extracted at all.
     */
    name: 'Placeholder-aware extraction',
    state: 'notStarted',
    note: 'A sentence containing {count} is extracted as fragments today, which breaks word order in German, Japanese and Arabic',
  },
  {
    name: 'Visual context capture',
    state: 'notStarted',
    note: 'Per-component screenshots, so whoever chooses a word can see where it appears',
  },
  {
    name: 'Typed SDK',
    state: 'notStarted',
    note: 'A missing key should fail the build, not the user',
  },
  { name: 'Review surface for non-developers', state: 'notStarted' },
  {
    name: 'Billing',
    state: 'notStarted',
    note: 'Nothing is priced until the cost of running it is modelled',
  },
  {
    name: 'Human preference benchmarks per language',
    state: 'unmeasured',
    note: 'The evaluation harness is built; the study has not run',
  },
];

/*
 * Counted, not written. "Six of eleven" was a sentence beside a list, and the
 * list could change without it.
 */
const WORKING = ITEMS.filter((item) => item.state === 'working').length;

export function BuildStatus() {
  return (
    <section className="border-t border-subtle bg-surface/40">
      <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 sm:py-28">
        <div className="grid gap-10 lg:grid-cols-12 lg:gap-16">
          <SectionHeading
            className="lg:col-span-4"
            eyebrow="Status"
            title="What actually works today"
          >
            <p className="mt-4 text-prose text-secondary">
              This is an early-access product. Rather than describe the roadmap
              in the present tense, here is the honest state of it.
            </p>
            <p className="mt-4 text-small leading-6 text-tertiary">
              {WORKING} of {ITEMS.length} capabilities ship today. The rest are
              named here rather than implied elsewhere.
            </p>
          </SectionHeading>

          <div className="lg:col-span-8">
            <ul className="border-t border-subtle">
              {ITEMS.map((item) => {
                const state = STATE[item.state];
                const Icon = state.icon;
                return (
                  <li
                    key={item.name}
                    className="flex items-start gap-3 border-b border-subtle py-3.5"
                  >
                    <span
                      className={cn(
                        'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border',
                        state.mark,
                      )}
                    >
                      <Icon
                        className="size-2.5"
                        aria-hidden="true"
                        strokeWidth={3}
                      />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={cn('text-body font-medium', state.text)}>
                        {item.name}
                      </span>
                      {item.note ? (
                        <span className="mt-0.5 block text-small leading-5 text-tertiary">
                          {item.note}
                        </span>
                      ) : null}
                    </span>
                    {/*
                      The word is printed only where it says something.
                      ───────────────────────────────────────────────
                      Eight of thirteen rows are `working`, so the right-hand
                      column was the word WORKING eight times over — the most
                      repetitive element on the page, drawing the eye to the
                      rows that need it least. The five that are not shipped are
                      what a reader comes to this section for, and they were set
                      in the same type as the eight that are.

                      The jade tick already carries `working`, and it carries it
                      without colour: the shape differs from the circle and the
                      dash, so §13's rule that colour is never the only carrier
                      is satisfied by the mark, not by the label. The other four
                      states share two glyphs between them, so for those the
                      word is the only thing that separates "built but unused"
                      from "not started" — and there it stays.

                      Screen readers lose nothing. The label is still rendered
                      for every row; on the shipped ones it is `sr-only`, so the
                      list reads identically and only looks different.
                    */}
                    <span
                      className={cn(
                        'shrink-0 text-caption uppercase tracking-wide',
                        item.state === 'working' ? 'sr-only' : 'text-secondary',
                      )}
                    >
                      {state.label}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
