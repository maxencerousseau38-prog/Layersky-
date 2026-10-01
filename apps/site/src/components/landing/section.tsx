import { cn } from '@localize-infra/ui';
import type { LucideIcon } from 'lucide-react';
import type * as React from 'react';

/**
 * The landing page's layout primitives, taken from the reference template
 * rather than approximated.
 *
 * Every section of this page previously wrote its own container and its own
 * vertical padding — `mx-auto max-w-7xl px-4 py-20 sm:px-6 sm:py-28`, eleven
 * times, with three of them disagreeing. The template does not do that: it has
 * one container class and one rhythm, and every section composes them.
 *
 * ## What was taken, exactly
 *
 * - **`Container`** is the template's `container mx-auto px-4 sm:px-6 lg:px-8`.
 *   The third step is the part this page did not have: it stopped at `sm:px-6`,
 *   so between 1024 and 1536 the gutter stayed at 24px while the content column
 *   grew, and the page read edge-to-edge on a laptop.
 * - **`Section`** is the template's `py-24 sm:py-32`. This page ran
 *   `py-20 sm:py-28` — 80/112 against 96/128 — which is why it felt tighter
 *   than the reference at every breakpoint while using the same type scale.
 * - **`FeatureItem`** is the template's feature-list row, the one it uses twice
 *   in `features-section.tsx`: a `group` with a bordered icon box, a title and
 *   a description, hovering to a tinted ground.
 *
 * ## What was not taken
 *
 * `max-w-7xl` stays. The template's bare `container` resolves to the Tailwind
 * default, which is wider; this page's measure is already set by `DESIGN.md`
 * §4.2 and is not a landing-page decision.
 *
 * The radii are Layersky's: `rounded-lg` is 10px here (§5.1, cards and panels),
 * where the template's `rounded-lg` is its own 10px and its cards use
 * `rounded-xl` at 14px. The token is not changed to match a screenshot.
 */

export function Container({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn('mx-auto max-w-7xl px-4 sm:px-6 lg:px-8', className)}>
      {children}
    </div>
  );
}

/**
 * One landing section, with the template's rhythm.
 *
 * `ground` paints a full-bleed band. It is spelled out rather than passed as a
 * class so that the §4.4 signature — which reads whether a section paints its
 * own background — stays something a reader of this file can see.
 */
export function Section({
  id,
  labelledBy,
  ground = 'canvas',
  className,
  children,
  ...props
}: {
  id?: string;
  labelledBy?: string;
  ground?: 'canvas' | 'surface' | 'inverse';
  className?: string;
  children: React.ReactNode;
} & Omit<React.HTMLAttributes<HTMLElement>, 'id' | 'className' | 'children'>) {
  return (
    <section
      id={id}
      aria-labelledby={labelledBy}
      className={cn(
        'py-24 sm:py-32',
        ground === 'surface' && 'border-y border-subtle bg-surface/40',
        ground === 'inverse' && 'border-y border-subtle bg-primary',
        className,
      )}
      {...props}
    >
      {children}
    </section>
  );
}

/**
 * A feature row: icon, title, one line.
 *
 * The template's version, with its hover ground and its `items-start` icon
 * alignment. Two differences, both forced by this product rather than chosen:
 *
 * - the icon sits in a bordered box rather than floating, because these rows
 *   appear on `surface` grounds where a bare icon has nothing to sit against;
 * - `tone` paints the icon box only where the row reports a real state. A
 *   feature list is not a status board, so the default is no tone at all —
 *   §6.3 reserves colour for something whose state actually exists.
 */
export function FeatureItem({
  icon: Icon,
  title,
  children,
  tone = 'none',
}: {
  icon: LucideIcon;
  title: string;
  children: React.ReactNode;
  tone?: 'none' | 'confident';
}) {
  return (
    <li className="group flex items-start gap-3 rounded-lg p-2 transition-colors duration-(--duration-micro) hover:bg-surface motion-reduce:transition-none">
      <span
        aria-hidden="true"
        className={cn(
          'mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md border',
          tone === 'confident'
            ? 'border-confident/25 bg-confident-bg text-confident-text'
            : 'border-subtle bg-canvas text-tertiary',
        )}
      >
        <Icon className="size-4" strokeWidth={1.75} />
      </span>
      <span className="min-w-0">
        <span className="block text-body font-medium text-primary">
          {title}
        </span>
        <span className="mt-1 block text-small leading-6 text-secondary">
          {children}
        </span>
      </span>
    </li>
  );
}

/**
 * The template's two-column feature split: `grid items-center gap-12
 * lg:grid-cols-2 lg:gap-8 xl:gap-16`.
 *
 * Kept as a named component because §4.4 measures the column count of the
 * widest grid a section owns, so "this section is a two-column split" is a
 * structural fact the page is tested on, not a formatting detail.
 */
export function FeatureSplit({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'grid items-center gap-12 lg:grid-cols-2 lg:gap-8 xl:gap-16',
        className,
      )}
    >
      {children}
    </div>
  );
}
