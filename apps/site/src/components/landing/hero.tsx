import { CheckCycle } from '@/components/landing/check-cycle';
import { APP_URL, EXAMPLE_CYCLE } from '@/lib/constants';
import { Badge, Button } from '@localize-infra/ui';
import { GitPullRequest } from 'lucide-react';

/**
 * The hero.
 *
 * Previously: headline, then a product panel sitting on the same white ground
 * as the six sections beneath it, then the install line. It was composed
 * correctly and had no focal point — the page opened at the same visual
 * temperature it held for the next five thousand pixels, and the artifact read
 * as one more card rather than as the thing being sold.
 *
 * Now the words and the product are on different grounds. The argument stays on
 * canvas at a narrow measure; the evidence drops onto a full-bleed dark band and
 * is the first thing on the page with any weight to it.
 *
 * **What that band shows changed on 2026-10-03.** It used to be run
 * `b6fbbf11` — the legacy pipeline, extracting and translating a whole
 * repository from a button in the hosted app — against a *private* fixture,
 * so the caption had to admit the pull request could not be linked. It now
 * shows the guardrail cycle on a public repository: a check that found six
 * problems, the corrective pull request, and the same check green. The page's
 * strongest moment is now both the current product and openable by a stranger.
 */
export function Hero() {
  return (
    <>
      {/* The template's hero rhythm: `pt-16 sm:pt-20 pb-16`. This ran
          `pt-10 sm:pt-14 pb-8`, which put the h1 40px under a 64px sticky bar
          and gave the fold no room to breathe above the product's first
          sentence. */}
      <section className="mx-auto max-w-7xl px-4 pb-16 pt-16 sm:px-6 sm:pt-20 lg:px-8">
        {/*
         * An asymmetric split, not a headline with a void beside it.
         *
         * Measured at 1440: the argument occupied the left half and the right
         * half held nothing for roughly 300px of height, with the action row
         * pushed to the far edge of that emptiness — the dead zone DESIGN.md
         * §4.5.2 names as a defect rather than whitespace. The slack is now
         * composed away with content that was already on the page: the
         * terminal path, which used to sit in an orphaned strip *below* the
         * run and interrupted the page's strongest moment to do it.
         *
         * The section is also ~180px shorter, which is the point. The run
         * artifact is the best argument this page has, and it began below the
         * fold on every desktop viewport (DESIGN.md §4.5.1).
         */}
        {/*
         * The split starts at xl, not lg, and the terminal column is 30rem.
         *
         * Both numbers were measured rather than chosen. `CopyCommand`
         * truncates rather than overflows, and the install command needs 28rem
         * of *inner* width at `subtitle` mono — so 28rem here silently ate
         * `init`, because this panel spends 1rem of padding on each side. And
         * at lg the container is only 976px, which would leave the headline
         * 466px: enough to break a 68px display line three ways. Below xl the
         * panel stacks full width, where it has more room than any split gave
         * it.
         */}
        {/* gap-6 below xl: this is now the space between the action row and a
            single-line terminal strip that belongs with it, not the space
            between two blocks. gap-10 at xl is a column gutter, a different
            job. */}
        {/*
         * Centred, which reverses the split above — and the reason the split
         * existed does not apply to this shape.
         *
         * That comment describes a *left-aligned* headline with an empty right
         * half: 300px of dead zone beside the argument, which §4.5.2 names as
         * a defect. A centred column has no second half to leave empty. The
         * terminal path moves below the actions instead of beside them, which
         * is where the reference template puts its secondary element, and the
         * run artifact keeps the full-bleed band directly under it.
         */}
        <div className="mx-auto flex max-w-4xl flex-col items-center text-center">
          <div className="flex flex-col items-center">
            {/*
             * The positioning caught up with the product.
             *
             * This read "Localization infrastructure", and the headline below
             * it read "Your copy is a build artifact" — both describing
             * `extract → translate → open a pull request`, which is what this
             * product was when the page was written.
             *
             * It is no longer only that. A pull request now gets an i18n check
             * on the commit, and the capability was proved twice against a real
             * repository before this sentence was changed. Selling translation
             * alone undersold the half that runs on every push and needs
             * nobody to remember it.
             */}
            {/*
             * A `Badge`, which is how the template opens its hero
             * (`hero-section.tsx`: `<Badge variant="outline" className="px-4
             * py-2">` above the headline). This was a letter-spaced paragraph,
             * which reads as the first line of the h1 rather than as a label
             * on it — the badge has an edge, so the eye separates them.
             *
             * `tone="neutral"` is the template's `outline`: a bordered chip
             * with no icon, which is right for a label that reports no state.
             */}
            <Badge tone="neutral">Git-native i18n maintenance</Badge>

            {/*
             * 500, not 600, and only at this step.
             *
             * §3.3 allows 400, 500 and 600, and bans 700 because "at these
             * sizes it reads as shouting on a neutral ground". That reason does
             * not stop at 700: at `display-2xl` (68px) the argument applies to
             * 600 as well, and the headline was carrying maximum size *and*
             * maximum weight at once. Compared side by side at 1440, 500 reads
             * as a statement and 600 as a claim being pressed — which is the
             * register §1.3 rules out.
             *
             * Section headings stay at 600. They run at `display-lg` (40px),
             * where 600 has the optical weight this has at 500, and `PageHeader`
             * already sets them there — one step, one weight, rather than a
             * blanket change that would have made every page title lighter for
             * a reason that only holds at 68px.
             */}
            <h1 className="mt-4 max-w-[19ch] font-display text-display-xl font-medium text-primary lg:text-display-2xl">
              Every pull request, checked for what it broke.
            </h1>

            {/* One sentence. The run below is the explanation; a second
                paragraph here only delays it. */}
            {/* One sentence for each half of the product, and no more. The
                run below is the explanation; a third sentence here only
                delays it. */}
            <p className="mt-5 max-w-[56ch] text-prose text-secondary">
              Layersky checks the i18n changes in every pull request, reports
              the problems as a check on the commit, and fixes the safe ones
              automatically in a pull request of its own. The rest it leaves
              named, for a person.
            </p>

            {/*
             * Two actions, and the filled one is the thing being sold.
             *
             * It used to read "Start a run", which named the legacy pipeline —
             * a person clicking a button in the hosted app to extract and
             * translate a whole repository. That is still there and still
             * works, but it is not what this page argues for any more: the
             * product is a check that runs on a pull request nobody had to
             * remember. The filled action is therefore the first step of that
             * path, in the hosted app's own words — create a workspace,
             * connect GitHub, get your first health check.
             *
             * The second action is evidence rather than documentation, and
             * that is new: the guardrail's fixture repository is **public**,
             * so for the first time this page can hand a visitor the actual
             * pull request instead of describing one. §4.5.3 ranks an action
             * that works above one that explains.
             */}
            <div className="mt-8 flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:items-center sm:justify-center">
              <Button
                asChild
                variant="primary"
                size="lg"
                className="w-full sm:w-auto"
              >
                <a href={APP_URL}>Connect your repository</a>
              </Button>
              <Button
                asChild
                variant="secondary"
                size="lg"
                className="w-full sm:w-auto"
              >
                <a
                  href={EXAMPLE_CYCLE.pull.url}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  <GitPullRequest aria-hidden="true" />
                  See a real check
                </a>
              </Button>
            </div>

            {/* Three steps, named because the product names them. A visitor
                clicking the action above lands on `/[org]/start`, which opens
                exactly one of them at a time; saying so here means the first
                screen is the one that was promised. */}
            <p className="mt-4 text-small leading-6 text-tertiary">
              Create a workspace, connect GitHub, get your first health check.
              Public repositories are free.
            </p>
          </div>
        </div>
      </section>

      {/* The cycle, on its own ground. Full-bleed and dark: this is the one
          moment the page asks the reader to stop and look at the product. */}
      <section
        aria-label="A check Layersky posted on a real pull request"
        className="border-y border-subtle bg-primary"
      >
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-10">
          <CheckCycle />

          {/*
           * Where it came from, said exactly — and this time followable.
           *
           * The band used to carry run `b6fbbf11`, whose pull request is in a
           * private repository; the caption had to end "that repository is
           * private, so the pull request cannot be linked". The i18next
           * fixture is public, so the sentence that replaces it is a link.
           */}
          <p className="mt-4 text-small text-inverse/60">
            Pull request{' '}
            <a
              href={EXAMPLE_CYCLE.pull.url}
              target="_blank"
              rel="noreferrer noopener"
              className="rounded-sm text-inverse underline underline-offset-2 decoration-inverse/40 hover:decoration-inverse focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            >
              #{EXAMPLE_CYCLE.pull.number}
            </a>{' '}
            on our i18next fixture, which is public. Every value above is read
            from the check runs on those two commits.
          </p>
        </div>
      </section>
    </>
  );
}
