import { Card, cn } from '@localize-infra/ui';
import type * as React from 'react';

/**
 * A counted fact, in a panel.
 *
 * ## Why these exist
 *
 * `/runs` ended at 426px of a 900px viewport — 47% filled, on the product's
 * primary data surface, which is the exact defect DESIGN.md §4.6 names and
 * measured at 590px when it was written. The page had four real facts about
 * the runs it was showing and put two of them in the header's metadata row, at
 * `caption` size, where they read as a timestamp rather than as an answer.
 *
 * `/[org]/usage` had the opposite problem with the same cause: five sections
 * of heading-then-content, no container anywhere on the page, and two figures
 * stretched across 1136px with 530px of nothing between them.
 *
 * ## What a tile may carry
 *
 * A number the page can point at a row for. Nothing here computes a trend, a
 * projection or a percentage of anything, because no surface in this product
 * records a previous period to compare against — the reference template fills
 * its four cards with "+12.5%" badges, and every one of them would be invented
 * here.
 *
 * ## Why `dl` and not headings
 *
 * A metric is a term and its value, which is what a description list is. The
 * alternative — `CardTitle`, which renders an `h3` — would put a heading level
 * on every tile and skip from the page's `h1` straight to `h3` on `/runs`,
 * where there is no section heading in between. `a11y.spec.ts` checks exactly
 * that.
 *
 * ## Geometry
 *
 * `Card` is `rounded-lg`, the 10px DESIGN.md §5.1 gives cards and panels. The
 * reference template's cards are 8px; matching them would mean editing the
 * radius scale to copy a screenshot, which §16 forbids and the token exists to
 * prevent.
 */
export function MetricGrid({
  label,
  columns = 3,
  className,
  children,
  ...props
}: {
  /** Names the group for a screen reader; there is no visible heading. */
  label: string;
  columns?: 2 | 3 | 4;
  className?: string;
  children: React.ReactNode;
} & Omit<React.HTMLAttributes<HTMLDListElement>, 'children'>) {
  return (
    <dl
      aria-label={label}
      className={cn(
        /*
         * Three abreast from `md`, not from `lg`.
         *
         * At `lg` the three tiles wrapped to two rows at 768 and pushed the
         * run table's first row to y=639 — measured, not guessed. Three
         * numbers spending 415px of a tablet viewport is the blankness
         * DESIGN.md §4.6 forbids wearing a different costume.
         *
         * 768 is also where the 256px sidebar appears, so the content column
         * *narrows* going from 767 to 768. That is the breakpoint pathology
         * this repository has already been bitten by once, which is why the
         * three-column step was verified at 768 rather than reasoned about.
         */
        'grid gap-3 sm:grid-cols-2',
        columns === 3 && 'md:grid-cols-3',
        columns === 4 && 'md:grid-cols-2 xl:grid-cols-4',
        className,
      )}
      {...props}
    >
      {children}
    </dl>
  );
}

export function Metric({
  label,
  value,
  note,
  badge,
  ...props
}: {
  label: string;
  /** Already formatted. This component does no arithmetic. */
  value: React.ReactNode;
  /** One line saying what the number counts, or over what window. */
  note?: React.ReactNode;
  /**
   * A state, when there is one to report.
   *
   * DESIGN.md §6.3: colour reports the state of something that exists. A tile
   * showing zero of something bad is not in a state, so it gets no badge —
   * passing one unconditionally is how "degraded" ends up meaning "this tile
   * has a number in it".
   */
  badge?: React.ReactNode;
} & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <Card className="p-4" {...props}>
      <dt className="text-caption text-tertiary">{label}</dt>
      <dd className="mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        {/* `title` 20px, the step the usage page already sets its figures at.
            Not `display` 28px: that is the page title's size, and a count is
            not allowed to tie the name of the page it sits on (§3.5). */}
        <span className="font-mono text-title tabular-nums text-primary">
          {value}
        </span>
        {badge}
      </dd>
      {note ? (
        <p className="mt-2 text-caption leading-5 text-tertiary">{note}</p>
      ) : null}
    </Card>
  );
}
