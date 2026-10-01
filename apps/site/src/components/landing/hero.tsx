import { RunArtifact } from '@/components/landing/run-artifact';
import {
  APP_URL,
  CLI_PERSONAL_TOKENS_LIVE,
  CLI_PUBLISHED_TO_NPM,
  EXAMPLE_PR_URL,
  INSTALL_COMMAND,
} from '@/lib/constants';
import { Button, CopyCommand } from '@localize-infra/ui';
import { GitPullRequest } from 'lucide-react';
import Link from 'next/link';

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
 * canvas at a narrow measure; the run drops onto a full-bleed dark band and is
 * the first thing on the page with any weight to it. That band also absorbs the
 * old PrProof section, which showed the same repository a second time further
 * down — one run, shown once, at the moment it does the most work.
 */
export function Hero() {
  return (
    <>
      <section className="mx-auto max-w-7xl px-4 pb-8 pt-10 sm:px-6 sm:pb-10 sm:pt-14">
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
        <div className="mx-auto flex max-w-3xl flex-col items-center text-center">
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
            <p className="text-eyebrow font-medium uppercase text-tertiary">
              Git-native i18n infrastructure
            </p>

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
              Translations that keep up with your code.
            </h1>

            {/* One sentence. The run below is the explanation; a second
                paragraph here only delays it. */}
            {/* One sentence for each half of the product, and no more. The
                run below is the explanation; a third sentence here only
                delays it. */}
            <p className="mt-5 max-w-[56ch] text-prose text-secondary">
              Layersky reads every pull request and says what it broke — a key
              with no translation, a placeholder dropped on the way into French
              — as a check on the commit. Point the CLI at a repository and it
              writes the translations too, and opens the pull request.
            </p>

            {/*
             * The filled action is the pull request only while a visitor can
             * open it.
             *
             * It linked to a pull request in a private repository, which is a
             * 404 for everyone but its owner — the page's strongest action was
             * its one broken one. §4.5.3 already settles what replaces an
             * action that does not work: the strongest one that does, promoted.
             * With no public pull request that is the docs.
             */}
            <div className="mt-8 flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:items-center sm:justify-center">
              {EXAMPLE_PR_URL ? (
                <>
                  <Button
                    asChild
                    variant="primary"
                    size="lg"
                    className="w-full sm:w-auto"
                  >
                    <a
                      href={EXAMPLE_PR_URL}
                      target="_blank"
                      rel="noreferrer noopener"
                    >
                      <GitPullRequest aria-hidden="true" />
                      See the pull request it opened
                    </a>
                  </Button>
                  <Button
                    asChild
                    variant="secondary"
                    size="lg"
                    className="w-full sm:w-auto"
                  >
                    <Link href="/docs#install">Read the docs</Link>
                  </Button>
                </>
              ) : (
                <>
                  {/*
                   * Two actions, both real, and the filled one is the product.
                   *
                   * There was one — "Read the docs" — because the pull request
                   * it used to point at was a 404 for everyone but its owner.
                   * Documentation is not the thing being sold, and the hosted
                   * app is: sign-up is open, public repositories are
                   * self-serve, and `APP_URL` is where that happens. The docs
                   * keep the outline variant, which is the reference
                   * template's arrangement and also the honest ranking.
                   */}
                  <Button
                    asChild
                    variant="primary"
                    size="lg"
                    className="w-full sm:w-auto"
                  >
                    <a href={APP_URL}>Start a run</a>
                  </Button>
                  <Button
                    asChild
                    variant="secondary"
                    size="lg"
                    className="w-full sm:w-auto"
                  >
                    <Link href="/docs#install">Read the docs</Link>
                  </Button>
                </>
              )}
            </div>
          </div>

          {/*
           * The terminal path, demoted on purpose.
           *
           * `npx @localize-infra/cli init` installs and runs, but it does not
           * translate anything until it is pointed at an API the reader runs
           * themselves. DESIGN.md §4.5.3 demotes an action that cannot finish
           * on its own, which is why this sits in a quiet panel saying what it
           * needs rather than taking the filled button.
           */}
          {/*
           * Two arrangements, because the tiers are genuinely different
           * problems rather than one problem at two sizes.
           *
           * At xl this is a column beside the headline: panel chrome, label
           * above, command and note stacked. It costs nothing vertically —
           * measured at 1280 the left block is 366px and this is 150px, so it
           * sits inside the space the argument already occupies.
           *
           * From 1024 to 1279 it cannot be a column at all. The left column
           * needs 584px (the width at which the 68px display headline breaks
           * in two) and the command box needs ~448px not to truncate, which is
           * 1064px before the gap — against a 976px container. Measured, not
           * guessed. So it stacks, and as a stacked block it was costing
           * 32px of gap plus 116px of height: the entire 148px by which this
           * tier's hero exceeded 1280's, pushing the run that much further
           * below the fold.
           *
           * Stacked it is therefore a strip, not a block — command and note
           * side by side, no label, because a heading on a control sitting
           * directly beneath the actions it belongs to is a label for
           * something already obvious.
           */}
          <div className="mt-10 w-full max-w-[34rem] rounded-lg border border-line bg-surface/60 p-4 text-start">
            {/* `text-eyebrow`, which carries its own 0.14em. The hand-written
                tracking this replaced was a seventh copy of a value the scale
                already defines (§3.3), and packages/ui's type-scale test
                enumerates the two files allowed to do that. */}
            <p className="text-eyebrow font-medium uppercase text-tertiary">
              From your terminal
            </p>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-5 xl:mt-3 xl:flex-col xl:items-stretch xl:gap-3">
              <div className="w-full sm:max-w-md xl:max-w-none">
                <CopyCommand command={INSTALL_COMMAND} />
              </div>
              {/* Both halves of this sentence come from CLI_PUBLISHED_TO_NPM,
                  which /docs also reads. It was prose in two places about one
                  external fact, which is one place that gets forgotten. */}
              <p className="text-small leading-6 text-tertiary">
                {!CLI_PUBLISHED_TO_NPM
                  ? 'Not published to npm yet — today it runs from a clone. '
                  : CLI_PERSONAL_TOKENS_LIVE
                    ? 'It runs against our hosted API with a personal token from your workspace. '
                    : 'It needs an API you run yourself — ours is not open to the CLI. '}
                <Link
                  href="/docs#install"
                  className="rounded-sm text-link underline underline-offset-2 hover:text-link-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                >
                  Install guide
                </Link>
                .
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* The run, on its own ground. Full-bleed and dark: this is the one
          moment the page asks the reader to stop and look at the product. */}
      <section
        aria-label="A run against a real repository"
        className="border-y border-subtle bg-primary"
      >
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-10">
          <RunArtifact />

          {/*
           * Where the run came from, said exactly.
           *
           * This read "A real run against a real repository, linked above.
           * Nothing on this page is a mockup." The link was a 404 for every
           * visitor, and the second sentence was broader than anything on the
           * page can prove — the "Close" example further down is illustrative.
           */}
          <p className="mt-4 text-small text-inverse/60">
            Run b6fbbf11, started from the hosted app on 29 August 2026 against
            our fixture repository. Its pull request was merged.
            {EXAMPLE_PR_URL
              ? ' The pull request is linked above.'
              : ' That repository is private, so the pull request cannot be linked; every value above is copied from it.'}
          </p>
        </div>
      </section>
    </>
  );
}
