'use client';

import { SiteNavMenu } from '@/components/site-nav-menu';
import { APP_URL, GITHUB_REPO_URL } from '@/lib/constants';
import { Button, ThemeToggle, cn } from '@localize-infra/ui';
import Link from 'next/link';
import * as React from 'react';

const NAV = [
  { href: '/docs', label: 'Docs' },
  { href: '/benchmarks', label: 'Benchmarks' },
  { href: '/quality', label: 'Quality' },
  { href: '/security', label: 'Security' },
  { href: '/pricing', label: 'Pricing' },
] as const;

/**
 * The site header.
 *
 * Was 48px — the application's topbar height, borrowed onto a marketing page
 * where it read as cramped rather than dense. 64px gives the wordmark and nav
 * room to sit as a considered band instead of a strip.
 *
 * The mark is three rules of descending width, echoing the State Rule that the
 * product uses to carry confidence. It is now graphite throughout: the old
 * version spent Iris on its top rule, and Iris means one thing in this system —
 * your judgement is required. Chrome does not get to borrow it, on the landing
 * page or anywhere else.
 *
 * The bar carries no divider and no backdrop until the page has actually
 * scrolled. Both were previously painted at rest, where there is nothing
 * underneath to separate — a hairline against the top of an unscrolled page is
 * chrome asserting itself rather than a response to content. They now
 * materialise when content passes beneath, which is the only moment they do any
 * work.
 */

/**
 * True once the page has scrolled far enough for content to sit under the bar.
 *
 * Reads on mount as well as on scroll: a restored scroll position or a load
 * straight to an anchor starts the page mid-document, where the bar has to be
 * materialised already rather than waiting for the user to move.
 */
function useScrolledUnder(threshold = 1) {
  const [scrolled, setScrolled] = React.useState(false);

  React.useEffect(() => {
    let frame = 0;

    const read = () => {
      frame = 0;
      setScrolled(window.scrollY > threshold);
    };

    // Scroll fires far more often than the screen paints; coalescing to one
    // read per frame keeps this off the input path, which is the whole point.
    const onScroll = () => {
      if (frame === 0) frame = window.requestAnimationFrame(read);
    };

    read();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (frame !== 0) window.cancelAnimationFrame(frame);
    };
  }, [threshold]);

  return scrolled;
}

export function SiteHeader() {
  const scrolled = useScrolledUnder();

  return (
    <header
      data-scrolled={scrolled || undefined}
      className={cn(
        'sticky top-0 z-40',
        // The border is always present and merely transparent at rest, so the
        // layout never shifts by a pixel when it appears.
        'border-b border-transparent bg-transparent',
        'transition-colors duration-(--duration-standard) ease-(--ease-standard)',
        scrolled && [
          'border-subtle bg-canvas/85 backdrop-blur-md',
          // The frosted bar is the enhancement; this is what it degrades to.
          'reduced-transparency:bg-canvas reduced-transparency:backdrop-blur-none',
        ],
      )}
    >
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-8 px-4 sm:px-6 lg:px-8">
        {/* The one tracking value on the site that is not carried by its type
            step. The wordmark is `body`-sized, and `body` is every paragraph,
            button and table cell in both apps — binding a wordmark's fit to it
            would push this onto all of them. A mark is a mark, so it keeps its
            own. */}
        <Link
          href="/"
          className="flex shrink-0 items-center gap-2.5 rounded-sm text-body font-semibold tracking-[-0.01em] text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          <span
            aria-hidden="true"
            className="flex h-4 w-4 flex-col justify-between py-[1px]"
          >
            <span className="block h-[2px] w-full rounded-full bg-primary" />
            <span className="block h-[2px] w-3/4 rounded-full bg-strong" />
            <span className="block h-[2px] w-1/2 rounded-full bg-line" />
          </span>
          Layersky
        </Link>

        {/*
         * The bar switches at `md`, not `sm`.
         *
         * At `sm` every part of it appeared at once — the padding stepped to
         * 24px, the five-link nav to 360px, the theme-and-GitHub cluster to
         * 105px — and the row then needed 692px on a 640px viewport. It
         * overflowed by 28px at exactly 640 and nowhere else, so the sweep in
         * responsive.spec.ts, which tested 390 then 768, stepped over it.
         *
         * The nav is what does not fit, so the nav is what moves. Nothing here
         * is resized: below 768 these controls live in the sheet, where they
         * already did below 640.
         */}
        <nav aria-label="Main" className="hidden md:block">
          <ul className="flex items-center gap-6">
            {NAV.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="rounded-sm text-body text-secondary transition-colors duration-(--duration-micro) hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="ms-auto flex items-center gap-3">
          <div className="hidden md:flex md:items-center md:gap-3">
            <ThemeToggle />
            <Button asChild variant="secondary" size="sm">
              <a
                href={GITHUB_REPO_URL}
                target="_blank"
                rel="noreferrer noopener"
              >
                GitHub
              </a>
            </Button>
            {/*
             * The way into the product, which this bar did not offer.
             *
             * Every action here pointed outward — a repository, a theme — so a
             * reader who had decided had nowhere to go but back to the hero.
             * The reference template ends its bar with a filled action for the
             * same reason, and `APP_URL` is a real one: sign-up is open and
             * public repositories are self-serve.
             *
             * Filled, and the only filled control in the bar. Two would make
             * neither primary.
             */}
            <Button asChild variant="primary" size="sm">
              <a href={APP_URL}>Start a run</a>
            </Button>
          </div>
          <SiteNavMenu items={NAV} />
        </div>
      </div>
    </header>
  );
}
