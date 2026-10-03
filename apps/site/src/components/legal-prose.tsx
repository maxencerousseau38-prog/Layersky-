import type * as React from 'react';

/**
 * The shared shape of /terms, /privacy and /contact.
 *
 * Three pages that are mostly headings and paragraphs, which is exactly the
 * situation where three hand-built layouts drift apart. `/security` already
 * settled what a section heading on this site looks like —
 * `font-display text-headline font-semibold` — and this exists so the legal
 * pages cannot quietly pick something else.
 *
 * One column, not the two-column grid `/security` uses. That page is a
 * reference somebody scans; these are documents somebody reads in order, and
 * a measure wider than ~70 characters is the one typographic rule a document
 * cannot break and stay readable (DESIGN.md §3.4).
 */
export function LegalSection({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="scroll-mt-24 pt-12 first:pt-0">
      <h2
        id={id}
        className="font-display text-headline font-semibold text-primary"
      >
        {title}
      </h2>
      <div className="mt-4 space-y-4 text-body leading-7 text-secondary">
        {children}
      </div>
    </section>
  );
}

/**
 * A list inside a legal section, at the same measure as its prose.
 *
 * Items carry their own id rather than being keyed by index. Index keys are a
 * lint error here and the lint is right even for static prose: the id is also
 * what a future anchor to a single clause would hang off.
 */
export function LegalList({
  items,
}: {
  items: ReadonlyArray<{ id: string; body: React.ReactNode }>;
}) {
  return (
    <ul className="space-y-2.5">
      {items.map((item) => (
        <li
          key={item.id}
          className="before:me-2 before:text-tertiary before:content-['—']"
        >
          {item.body}
        </li>
      ))}
    </ul>
  );
}

export function LegalPage({
  updated,
  children,
}: {
  updated: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-14 sm:px-6 sm:py-16">
      <p className="text-small text-tertiary">Last updated {updated}</p>
      <div className="mt-10">{children}</div>
    </div>
  );
}
