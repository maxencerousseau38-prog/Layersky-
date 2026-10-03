import { GatedAction } from '@/components/conversion-dialog';
import { BuildStatus } from '@/components/landing/build-status';
import { Commitments } from '@/components/landing/commitments';
import { ContinuousCheck } from '@/components/landing/continuous-check';
import { Ecosystem } from '@/components/landing/ecosystem';
import { Hero } from '@/components/landing/hero';
import { HowItWorks } from '@/components/landing/how-it-works';
import { Container, Section } from '@/components/landing/section';
import {
  CLI_PERSONAL_TOKENS_LIVE,
  CLI_PUBLISHED_TO_NPM,
  INSTALL_COMMAND,
} from '@/lib/constants';
import { CopyCommand } from '@localize-infra/ui';
import Link from 'next/link';

export default function HomePage() {
  return (
    <>
      {/* PrProof used to sit between these two. It showed the same repository
          and the same diff the hero already shows, one screen later — the page
          made its strongest argument twice and neither time at full strength.
          The run now appears once, in the hero, on its own dark ground. */}
      <Hero />
      <HowItWorks />
      {/*
       * The check goes here, between the pipeline and what it leaves alone.
       *
       * `HowItWorks` describes the run a person starts; this describes the one
       * nobody starts. Putting it after means a reader has seen what Layersky
       * produces before being told it also watches — and putting it before
       * `Ecosystem` keeps "nothing else in your stack has to change" as the
       * answer to both halves rather than only to the CLI.
       */}
      <ContinuousCheck />
      <Ecosystem />
      <Commitments />
      <BuildStatus />

      {/* The close. Previously a small heading and a command in the same
          left-aligned shape as every other section, which made the page end
          rather than finish. Centred is earned here — it is the one moment the
          page asks for a single thing — and the surface shift bookends the
          dark band above. */}
      {/*
       * Canvas, not a third tinted band. Ecosystem and the status board above
       * are both `surface`, and closing on `surface/60` made the last third of
       * the page one continuous grey with hairlines through it. The page now
       * alternates deliberately — canvas, dark, canvas, surface, canvas,
       * surface, canvas — so a reader feels sections change rather than
       * scrolling through an undifferentiated field.
       */}
      {/*
       * The close bookends the hero.
       *
       * The page opens with a run against our fixture repository, on a dark
       * band; it ends by asking for a run against theirs, on the same ground.
       * That pairing is the argument — you have seen exactly what arrives, now
       * point it at your own code — and it reads as a deliberate return rather
       * than the centred call-to-action every developer site ends on.
       *
       * By this line the reader has seen the artefact, the five stages, an
       * escalation, what the CLI leaves alone and a board naming what is not
       * built. Conversion is asked for after the value, never before it.
       */}
      <Section ground="inverse" className="border-b-0">
        <Container>
          {/*
           * The template's closing CTA: `mx-auto max-w-4xl` centred, heading
           * over a centred action row (`cta-section.tsx`).
           *
           * This was a 26rem/1fr split with the action in the right column,
           * and at 1440 that left the band around 140px taller than its
           * content with a hole under the heading — §4.5.2's dead zone, on the
           * one section whose whole job is to be acted on. Centred, the band
           * also bookends the hero, which is centred too; the comment below
           * argued the opposite and described a shape the page no longer had.
           */}
          <div className="mx-auto max-w-4xl text-center">
            <div>
              {/* A `Badge`, like every other section eyebrow on the page.
                  `Badge` paints a light ground, so on the inverse band it is
                  re-toned rather than left to disappear. */}
              <span className="inline-flex items-center rounded-sm border border-inverse/25 bg-inverse/10 px-1.5 py-0.5 text-caption font-medium leading-4 text-inverse/80">
                Your turn
              </span>
              <h2 className="mt-4 text-balance font-display text-display font-semibold text-inverse sm:text-display-lg">
                Now put it on yours
              </h2>
              {/* This described the CLI — "extraction runs on your machine"
                  — which is the path the page no longer leads with. The
                  sentence that belongs under this heading is what the check
                  costs a repository to try, and the answer is three steps and
                  no merge it can block. */}
              <p className="mx-auto mt-5 max-w-[52ch] text-prose text-inverse/70">
                A workspace, a GitHub connection, and the next pull request gets
                a check. It is never a blocking one, so the worst it can do on
                day one is tell you something you did not know.
              </p>
            </div>

            <div className="mt-10">
              {/*
               * Both buttons are re-toned for an inverse band.
               *
               * `primary` paints itself `bg-primary` — the same token this band
               * uses — so on it the button had a 1:1 background contrast with
               * its own ground in *both* themes, and read as bare text rather
               * than a control. `secondary` paints `bg-canvas`, which on an
               * inverse band is the high-contrast treatment, so it was quietly
               * louder than the primary action beside it.
               *
               * The roles swap to match the ground: the primary action takes
               * the solid canvas fill, and the secondary becomes an outline in
               * the band's own foreground colour. Both track the theme, because
               * every token here is the semantic pair, not a fixed colour.
               */}
              {/*
               * One filled action on the page, and it is not this one.
               *
               * This band used to carry a canvas-filled "Run it on your
               * repository" — the loudest control on the dark ground — while
               * the hero carried a graphite-filled link to the pull request.
               * Two primaries, where DESIGN.md §10 allows one.
               *
               * §4.5.3 settles which survives rather than leaving it to taste:
               * the primary must be an action that works today, and where the
               * nominal one is unavailable — it names a gated beta explicitly —
               * it is demoted and the strongest working action promoted. This
               * button opens a dialog rather than doing the thing it names, so
               * it stays an outline and the fold keeps the one fill.
               */}
              <div className="flex flex-col justify-center gap-3 sm:flex-row sm:flex-wrap sm:items-center">
                <GatedAction
                  variant="secondary"
                  className="w-full border-inverse/30 bg-transparent text-inverse hover:bg-inverse/10 active:bg-inverse/15 sm:w-auto"
                >
                  Put it on your repository
                </GatedAction>
              </div>
              <p className="mx-auto mt-5 max-w-[60ch] text-small text-inverse/60">
                {/* "The CLI runs from a clone today" stood here for two weeks
                    after the package reached npm, because it was prose rather
                    than a read of the flag the hero and /docs already use. */}
                {/* The CLI is still here, still true, and no longer the
                    headline. It does a different job from the check — it
                    finds hardcoded strings in source, which the check does
                    not — so it is named rather than dropped. */}
                {!CLI_PUBLISHED_TO_NPM
                  ? 'There is also a CLI, which runs from a clone today. Read '
                  : CLI_PERSONAL_TOKENS_LIVE
                    ? 'There is also a CLI for extracting hardcoded strings, on npm, running against our hosted API with a personal token. Read '
                    : 'There is also a CLI for extracting hardcoded strings, on npm, translating through an API you run yourself. Read '}
                <Link
                  href="/docs"
                  className="rounded-sm text-inverse underline underline-offset-2 decoration-inverse/40 hover:decoration-inverse focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                >
                  the documentation
                </Link>{' '}
                or{' '}
                <Link
                  href="/roadmap"
                  className="rounded-sm text-inverse underline underline-offset-2 decoration-inverse/40 hover:decoration-inverse focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                >
                  what is shipping next
                </Link>
                .
              </p>

              {/*
               * The terminal path, moved here from the hero.
               *
               * It was directly under the headline, which put a command for
               * the *other* product in the first thing a visitor reads — and
               * the hero now argues for a GitHub App that needs nothing
               * installed. Deleting it outright was wrong for two reasons:
               * the CLI works, and a developer landing page with nothing to
               * copy has no affordance at all.
               *
               * So it sits after the evidence, under the close, which is also
               * the honest ranking. DESIGN.md §4.5.3 demotes a secondary
               * action rather than hiding it.
               */}
              <div className="mx-auto mt-8 w-full max-w-[34rem] rounded-lg border border-inverse/20 bg-inverse/5 p-4 text-start">
                <p className="text-eyebrow font-medium uppercase text-inverse/60">
                  From your terminal
                </p>
                <div className="mt-3 flex flex-col gap-3">
                  <div className="w-full">
                    <CopyCommand command={INSTALL_COMMAND} />
                  </div>
                  {/* Both halves of this sentence come from
                      CLI_PUBLISHED_TO_NPM, which /docs also reads. It was
                      prose in two places about one external fact, which is one
                      place that gets forgotten. */}
                  <p className="text-small leading-6 text-inverse/60">
                    {!CLI_PUBLISHED_TO_NPM
                      ? 'Not published to npm yet — today it runs from a clone. '
                      : CLI_PERSONAL_TOKENS_LIVE
                        ? 'It runs against our hosted API with a personal token from your workspace. '
                        : 'It needs an API you run yourself — ours is not open to the CLI. '}
                    <Link
                      href="/docs#install"
                      className="rounded-sm text-inverse underline underline-offset-2 decoration-inverse/40 hover:decoration-inverse focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                    >
                      Install guide
                    </Link>
                    .
                  </p>
                </div>
              </div>
            </div>
          </div>
        </Container>
      </Section>
    </>
  );
}
