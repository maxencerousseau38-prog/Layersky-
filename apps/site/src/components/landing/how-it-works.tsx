import { Container, Section } from '@/components/landing/section';
import { SectionHeading } from '@/components/landing/section-heading';
import {
  PIPELINE_STAGES,
  type PipelineStageId,
  StateRule,
} from '@localize-infra/ui';

/**
 * The pipeline, drawn.
 *
 * This was four numbered paragraphs of roughly sixty words each — the section a
 * reader consults to find out what happens to their repository, written as a
 * document. Nobody reads four paragraphs to decide whether to try a CLI, and
 * the sequence, which is the actual argument, was carried only by the numbers.
 *
 * It is now the five canonical stages as a connected rail, one clause each,
 * every clause taken from `PIPELINE_STAGES` so the words here cannot drift from
 * the words in the product (DESIGN.md §1.4). The prose that used to explain
 * Escalate is spent instead on showing one — because the claim that the agent
 * surfaces ambiguity rather than guessing is the difference between this and a
 * translation API, and it is the only claim on the page that needs an example
 * to land.
 *
 * That example carries no Iris, and the reason is worth keeping next to the
 * code rather than only at the call site: it depicts an unresolved string, so
 * Iris looks like the honest choice, but nobody reading a marketing page is
 * being asked to resolve anything. Spending the product's one
 * judgement-required signal on an illustration of itself is the dilution
 * §1.4 forbids, and a site-wide test enforces the absence.
 *
 * This docstring used to claim the opposite — "the one place Iris appears on
 * this site" — describing a version that shipped before the tone was changed
 * to neutral, twenty lines above an implementation comment saying exactly the
 * reverse.
 */

/** What each stage leaves behind, shown as the reader would see it. */
const ARTIFACT: Record<PipelineStageId, string> = {
  detect: 'Vite + React',
  extract: 'locales/en.json',
  translate: 'locales/<locale>.json',
  escalate: 'a question, not a guess',
  'pull-request': 'one branch, one commit',
};

export function HowItWorks() {
  return (
    <Section>
      <Container>
        <SectionHeading
          eyebrow="How it works"
          title="One command, five stages, no new tab"
        />

        {/*
         * Three arrangements, because one column of five is wasteful at tablet
         * width and two columns of five are unreadable at phone width.
         *
         *   <640    one column, connected spine
         *   640…1023 two columns, no spine
         *   ≥1024   five columns, horizontal rail
         *
         * The middle tier is the one that needed care. This section was 1477px
         * at 768 with the rail alone taking 487 of it — five stages stacked down
         * a 720px-wide column, each about 360px narrower than it had room for.
         *
         * The spine is *removed* there rather than duplicated, and that is the
         * whole design. A vertical connector drawn down two columns is literally
         * two pipelines side by side, which is the failure the previous version
         * of this comment refused to risk — rightly. Without it the ordinals do
         * the work they were always for: 01…05 in reading order, no line
         * implying a flow the layout cannot honour.
         *
         * Below 640 the columns would be ~171px, too narrow for a stage summary
         * plus a mono artifact path, so that tier keeps the spine unchanged.
         */}
        <ol
          aria-label="The five pipeline stages"
          className="mt-10 grid gap-y-6 sm:grid-cols-2 sm:gap-x-8 lg:grid-cols-5 lg:gap-x-6"
        >
          {PIPELINE_STAGES.map((stage, i) => {
            const last = i === PIPELINE_STAGES.length - 1;
            return (
              <li key={stage.id} className="relative ps-8 lg:ps-0 lg:pt-8">
                {/* Connector. Runs to the next node and stops at the last. */}
                {!last && (
                  <span
                    aria-hidden="true"
                    // -1.5rem tracks the list's row gap exactly: the spine has to
                    // reach the next node, and a connector that stops short of it
                    // draws five separate items rather than one sequence.
                    //
                    // `sm:hidden lg:block` is the two-column tier opting out. A
                    // spine there would run down each column independently and
                    // read as two pipelines, and item 04's connector would point
                    // at empty space rather than at 05.
                    className="absolute start-[7px] top-4 bottom-[-1.5rem] w-px bg-subtle sm:hidden lg:block lg:start-4 lg:top-[7px] lg:bottom-auto lg:h-px lg:w-[calc(100%+1.5rem)]"
                  />
                )}
                {/*
                 * Every node the same neutral, including the first.
                 *
                 * Detect's node was `border-confident` and the other four
                 * `border-strong`. Jade means one thing in this system —
                 * verified, current, merged, passing (§6.1) — and nothing here
                 * has run: this is a diagram of what the five stages *are*, not
                 * a run in progress. §2.4 settles it in one line: a screen with
                 * no state on it has no colour on it.
                 *
                 * It was worse than decorative. The hero's run artifact sits a
                 * screen above this and marks all five stages jade because that
                 * run genuinely completed all five, so a reader arrives here
                 * having just learned that a jade node means "this stage
                 * finished" — and meets a pipeline where only Detect is jade,
                 * which reads as a run that stops after stage one. The e2e suite
                 * guards Iris against exactly this misuse and has no equivalent
                 * for jade, which is how it survived.
                 */}
                <span
                  aria-hidden="true"
                  className="absolute start-0 top-1 size-3.5 rounded-full border-2 border-strong bg-canvas lg:top-0"
                />

                {/*
                 * The ordinal sits with the name rather than on a line of its
                 * own. It was one full text line of chrome per stage, five times
                 * over, to carry two mono characters — and §2.3 asks for density
                 * bought by removing chrome, not by shrinking type. Nothing is
                 * lost: the number is still visible, still in document order,
                 * and the list is still an `ol`.
                 */}
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-micro uppercase tracking-wide text-tertiary">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <h3 className="text-subtitle font-semibold text-primary">
                    {stage.name}
                  </h3>
                </div>
                <p className="mt-1.5 text-small leading-6 text-secondary">
                  {stage.summary}
                </p>
                <p className="mt-2.5 truncate font-mono text-micro text-tertiary">
                  {ARTIFACT[stage.id]}
                </p>
              </li>
            );
          })}
        </ol>

        {/* The one stage that needs showing rather than describing. */}
        <div className="mt-16 grid gap-8 border-t border-subtle pt-10 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] lg:gap-16">
          <div>
            <p className="text-eyebrow font-medium uppercase text-tertiary">
              Stage 04, in practice
            </p>
            <h3 className="mt-3 font-display text-title font-semibold text-primary">
              It asks instead of guessing
            </h3>
            <p className="mt-3 text-prose text-secondary">
              A translation API returns a string for every input, including the
              ones it had no way to get right. Where the code does not settle
              the question, the run reports it and moves on — the other strings
              still ship.
            </p>
          </div>

          {/*
           * Neutral, not `ambiguous`, and a test enforces it site-wide.
           *
           * This card depicts an unresolved string, so Iris looks like the honest
           * choice — but nobody reading a marketing page is being asked to
           * resolve anything. Painting the ambiguity colour here would spend the
           * product's one judgement-required signal on an illustration of itself,
           * which is exactly the dilution DESIGN.md §1.4 forbids. The content and
           * the two-option list carry the meaning without it.
           */}
          <StateRule
            tone="neutral"
            className="rounded-e-lg bg-surface/60 py-5 pe-5"
          >
            <p className="font-mono text-caption text-tertiary">
              src/components/Dialog.tsx:24
            </p>
            <p className="mt-2 text-title font-medium text-primary">
              &ldquo;Close&rdquo;
            </p>
            <p className="mt-3 max-w-[52ch] text-small leading-6 text-secondary">
              A verb on a button, an adjective in a sentence. German needs
              different words for each, and the surrounding code does not say
              which this is.
            </p>
            <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-2 border-t border-subtle pt-4">
              <div>
                <dt className="font-mono text-micro uppercase tracking-wide text-tertiary">
                  If it is the verb
                </dt>
                <dd lang="de" className="mt-1 text-body text-primary">
                  Schließen
                </dd>
              </div>
              <div>
                <dt className="font-mono text-micro uppercase tracking-wide text-tertiary">
                  If it is the adjective
                </dt>
                <dd lang="de" className="mt-1 text-body text-primary">
                  Nah
                </dd>
              </div>
            </dl>
          </StateRule>
        </div>
      </Container>
    </Section>
  );
}
