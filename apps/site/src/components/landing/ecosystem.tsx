import {
  Container,
  FeatureSplit,
  Section,
} from '@/components/landing/section';
import { SectionHeading } from '@/components/landing/section-heading';
import type * as React from 'react';

/**
 * The ecosystem rail.
 *
 * The wording carries the honesty here, not a curated list. Only GitHub is an
 * integration — it is where the pull request goes. Everything else on the rail
 * is something the CLI deliberately does *not* touch: your framework, your
 * host, your database carry on unchanged, because the tool reads your
 * repository and writes locale files back to it. Stated that way, showing
 * Vercel or Supabase claims nothing untrue and makes a real point — adopting
 * this costs you no other change.
 *
 * Monochrome throughout, so the rail never becomes the focus and six brand
 * palettes cannot compete with the state colours that carry the product's
 * actual meaning. Hover lifts a mark from `tertiary` to `secondary` — a step
 * in the neutral ramp, not a colour.
 *
 * This said "Colour arrives only on hover, as an acknowledgement", which
 * described something the code has never done and §6.3 forbids outright:
 * colour on logos and brand marks. The implementation was right and the
 * comment invited someone to break it.
 */
type Mark = { name: string; path: React.ReactNode; viewBox?: string };

/* Simplified monochrome marks, drawn with `currentColor` so they inherit the
   rail's treatment rather than importing eight brand palettes. */
const MARKS: Mark[] = [
  {
    name: 'GitHub',
    path: (
      <path d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.55v-2.1c-3.2.7-3.88-1.37-3.88-1.37-.53-1.35-1.29-1.7-1.29-1.7-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.2 1.77 1.2 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.56-.29-5.25-1.28-5.25-5.7 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11 11 0 0 1 5.8 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.12 3.05.74.81 1.18 1.84 1.18 3.1 0 4.43-2.69 5.4-5.26 5.69.41.36.78 1.06.78 2.14v3.17c0 .3.21.66.8.55A11.5 11.5 0 0 0 12 .5Z" />
    ),
  },
  {
    name: 'Next.js',
    path: (
      <>
        <path d="M12 1.5A10.5 10.5 0 1 0 22.5 12 10.5 10.5 0 0 0 12 1.5Zm0 19.2a8.7 8.7 0 1 1 8.7-8.7 8.7 8.7 0 0 1-8.7 8.7Z" />
        <path d="M9.1 7.6h1.6l6.2 8.7-1.3.95-6.5-9.1Zm6.4 0h1.5v6.1l-1.5-2.1Z" />
      </>
    ),
  },
  {
    name: 'React',
    path: (
      <>
        <circle cx="12" cy="12" r="2.1" />
        <ellipse
          cx="12"
          cy="12"
          rx="10"
          ry="3.9"
          fill="none"
          strokeWidth="1.4"
          stroke="currentColor"
        />
        <ellipse
          cx="12"
          cy="12"
          rx="10"
          ry="3.9"
          fill="none"
          strokeWidth="1.4"
          stroke="currentColor"
          transform="rotate(60 12 12)"
        />
        <ellipse
          cx="12"
          cy="12"
          rx="10"
          ry="3.9"
          fill="none"
          strokeWidth="1.4"
          stroke="currentColor"
          transform="rotate(120 12 12)"
        />
      </>
    ),
  },
  {
    name: 'TypeScript',
    path: (
      <>
        <rect
          x="1.5"
          y="1.5"
          width="21"
          height="21"
          rx="2.5"
          fill="none"
          strokeWidth="1.6"
          stroke="currentColor"
        />
        <path d="M7 10.2h6v1.7h-2.1v6.4H9.1v-6.4H7Zm7.1 7.6c1.7.9 4.1.6 4.1-1.4 0-2.3-3.3-1.9-3.3-3.1 0-.6.6-.8 1.2-.7.5 0 1 .2 1.4.4v-1.7c-1.6-.6-3.9-.3-3.9 1.6 0 2.3 3.3 1.8 3.3 3.1 0 .7-.8.9-1.5.7a3.6 3.6 0 0 1-1.3-.6Z" />
      </>
    ),
  },
  {
    name: 'Vite',
    path: (
      <path d="M23 3.6 12.6 22.3a.7.7 0 0 1-1.2 0L1 3.6a.7.7 0 0 1 .74-1.03l10.1 1.8a.7.7 0 0 0 .25 0l9.9-1.8A.7.7 0 0 1 23 3.6ZM12 7.4l-5.6 1 5.2 9.4a.4.4 0 0 0 .7 0l5.2-9.4Z" />
    ),
  },
  {
    name: 'Node.js',
    path: (
      <path d="M12 1.2a1.5 1.5 0 0 1 .75.2l8.5 4.9a1.5 1.5 0 0 1 .75 1.3v9.8a1.5 1.5 0 0 1-.75 1.3l-8.5 4.9a1.5 1.5 0 0 1-1.5 0l-8.5-4.9a1.5 1.5 0 0 1-.75-1.3V7.6a1.5 1.5 0 0 1 .75-1.3l8.5-4.9a1.5 1.5 0 0 1 .75-.2Zm0 2L4.5 7.6v8.8l7.5 4.4 7.5-4.4V7.6Zm.2 4.4c2.2 0 3.4.9 3.4 2.5 0 .3-.2.5-.5.5h-.6a.5.5 0 0 1-.5-.4c-.15-.8-.7-1.1-1.8-1.1-1.3 0-1.8.4-1.8 1 0 .5.25.7 2 .95 2.2.3 3.3.8 3.3 2.4 0 1.6-1.35 2.6-3.6 2.6-2.6 0-3.7-1-3.7-2.7 0-.3.2-.5.5-.5h.6c.25 0 .45.15.5.4.2 1 .8 1.3 2.1 1.3 1.5 0 2-.5 2-1.1 0-.5-.25-.8-2.15-1-2.1-.25-3.15-.8-3.15-2.3 0-1.55 1.25-2.5 3.35-2.5Z" />
    ),
  },
  {
    name: 'Vercel',
    path: <path d="M12 2 23 21H1Z" />,
  },
  {
    name: 'Supabase',
    path: (
      <path d="M13.2 1.4c.6-.75 1.8-.2 1.8.75V9.3h6.1c1.05 0 1.6 1.25.9 2.05l-8.2 11.25c-.6.75-1.8.2-1.8-.75V14.7H5.9c-1.05 0-1.6-1.25-.9-2.05Z" />
    ),
  },
];

const INTEGRATION = MARKS.find((m) => m.name === 'GitHub') as Mark;
const UNTOUCHED = MARKS.filter((m) => m.name !== 'GitHub');

/**
 * One mark in the ecosystem lists.
 *
 * `integration` is the template's feature row from `features-section.tsx`: a
 * `group` that tints on hover, a bordered icon box, a title and one line of
 * description. The previous version was a bordered card per row, which gave a
 * two-item list the weight of a pricing table.
 *
 * `untouched` stays a bare inline mark — those rows carry no description and
 * are read as a set, not individually.
 */
function Logo({
  mark,
  tone = 'untouched',
  children,
}: {
  mark: Mark;
  tone?: 'integration' | 'untouched';
  children?: React.ReactNode;
}) {
  const glyph = (
    <svg
      viewBox={mark.viewBox ?? '0 0 24 24'}
      aria-hidden="true"
      className={
        tone === 'integration'
          ? 'size-4 fill-current text-primary'
          : 'size-4 shrink-0 fill-current text-tertiary transition-colors duration-(--duration-standard) group-hover:text-secondary motion-reduce:transition-none'
      }
    >
      {mark.path}
    </svg>
  );

  if (tone === 'untouched') {
    return (
      <li className="group flex shrink-0 items-center gap-2.5">
        {glyph}
        <span className="text-body text-tertiary transition-colors duration-(--duration-standard) group-hover:text-secondary motion-reduce:transition-none">
          {mark.name}
        </span>
      </li>
    );
  }

  return (
    <li className="group flex items-start gap-3 rounded-lg p-2 transition-colors duration-(--duration-micro) hover:bg-canvas motion-reduce:transition-none">
      <span
        aria-hidden="true"
        className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md border border-subtle bg-canvas"
      >
        {glyph}
      </span>
      <span className="min-w-0">
        <span className="block text-body font-medium text-primary">
          {mark.name}
        </span>
        <span className="mt-1 block text-small leading-6 text-secondary">
          {children}
        </span>
      </span>
    </li>
  );
}

export function Ecosystem() {
  return (
    <Section ground="surface" labelledBy="ecosystem">
      <Container>
        {/*
         * The template's two-column feature split, which this section needed
         * more than any other on the page.
         *
         * It ran as a full-width heading over a 5/7 grid, and at 1440 that
         * left roughly 500px of empty right-hand column beside the heading and
         * another band of nothing under a one-item list — the dead zone
         * DESIGN.md §4.5.2 calls a defect rather than whitespace. Measured on
         * the section: 638px tall, around 400px of it carrying anything.
         *
         * `FeatureSplit` is `features-section.tsx`'s own shape: the argument on
         * one side, the evidence on the other, both vertically centred. The
         * heading column now has a reason to be narrow and the lists have the
         * width they were short of.
         */}
        <FeatureSplit>
          <SectionHeading
            id="ecosystem"
            eyebrow="Compatibility"
            title="Nothing else in your stack has to change"
            className="max-w-none"
          >
            <p className="mt-4 text-prose text-secondary">
              The CLI reads your repository and writes locale files back to it.
              Your framework, your host and your database carry on exactly as
              they were.{' '}
              <strong className="font-medium text-primary">
                GitHub is the one integration
              </strong>{' '}
              — it is where the pull request goes. None of these projects
              endorse this one.
            </p>
          </SectionHeading>

          {/*
           * Two named groups, not a scrolling logo strip.
           *
           * The copy always said GitHub is the only integration and that
           * nothing here endorses this product — but a row of brand marks
           * sliding past is read as "trusted by" before anyone reaches a
           * sentence, so the device was working against its own caption.
           * Worse, it made the one fact this section exists to convey — what
           * the tool touches versus what it leaves alone — the one thing the
           * layout did not show.
           *
           * Stated as two groups it is information rather than decoration.
           */}
          <div className="flex flex-col gap-8">
            <div>
              <h3 className="text-eyebrow font-medium uppercase text-tertiary">
                Integrates with
              </h3>
              {/*
               * The list keeps an edge. The hover row this borrowed from the
               * template is written for a list of four to six; with exactly
               * one integration it read as an orphan floating on the band, so
               * the border moves from the row to the list that holds it.
               */}
              <ul
                aria-label="Systems this integrates with"
                className="mt-4 rounded-lg border border-line bg-canvas p-2"
              >
                <Logo mark={INTEGRATION} tone="integration">
                  Where the pull request goes. Installed as a GitHub App you
                  control.
                </Logo>
              </ul>
            </div>

            <div>
              <h3 className="text-eyebrow font-medium uppercase text-tertiary">
                Detected, then left alone
              </h3>
              <ul
                aria-label="Technologies this works alongside"
                className="mt-4 flex flex-wrap gap-x-6 gap-y-3"
              >
                {UNTOUCHED.map((mark) => (
                  <Logo key={mark.name} mark={mark} />
                ))}
              </ul>
              <p className="mt-4 max-w-[60ch] text-small leading-6 text-tertiary">
                The CLI recognises these where they are present and writes
                nothing to them. Your framework, host and database carry on
                exactly as they were.
              </p>
            </div>
          </div>
        </FeatureSplit>
      </Container>
    </Section>
  );
}
