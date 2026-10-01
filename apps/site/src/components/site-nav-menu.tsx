'use client';

import { GITHUB_REPO_URL } from '@/lib/constants';
import {
  Button,
  DialogRoot,
  DialogTitle,
  DialogTrigger,
  SheetContent,
  ThemeToggle,
  cn,
} from '@localize-infra/ui';
import { Menu } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';

/**
 * The small-screen navigation.
 *
 * It replaces a second header row whose links scrolled sideways. That row was
 * justified in a comment reading "three links do not justify a sheet" — true
 * when it was written, and no longer true once the nav grew to five and started
 * clipping. A horizontally scrolling strip of links is the tell of a nav that
 * outgrew its container.
 *
 * A sheet also matches what the application does at the same breakpoint, so the
 * two surfaces behave the same way on a phone rather than inventing separate
 * conventions.
 */
export function SiteNavMenu({
  items,
}: {
  items: ReadonlyArray<{ href: string; label: string }>;
}) {
  const [open, setOpen] = React.useState(false);

  return (
    <DialogRoot open={open} onOpenChange={setOpen}>
      <DialogTrigger
        className={cn(
          '-me-1 rounded-md p-2 text-secondary md:hidden',
          'transition-colors hover:bg-surface hover:text-primary active:bg-raised',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
        )}
      >
        <Menu className="size-5" aria-hidden="true" />
        <span className="sr-only">Open menu</span>
      </DialogTrigger>

      <SheetContent side="end" size="sm" aria-describedby={undefined}>
        <DialogTitle className="flex h-16 shrink-0 items-center px-5 text-body font-semibold text-primary">
          Layersky
        </DialogTitle>

        <nav aria-label="Main" className="px-3">
          <ul className="flex flex-col">
            {items.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onClick={() => setOpen(false)}
                  /* These rows exist only below sm, so `hover:` — which Tailwind
                     gates behind a hover-capable pointer — never reaches the
                     users who see them. The pressed state is the only feedback
                     a tap here can produce before the route changes. */
                  className="block rounded-md px-2 py-3 text-subtitle font-medium text-primary transition-colors hover:bg-surface active:bg-raised focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-focus"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        {/* Theme lives in here on a phone rather than in the bar. Three
            segments cost more width than they earn beside a menu button. */}
        <div className="mt-auto flex items-center justify-between gap-4 border-t border-subtle p-5">
          <ThemeToggle />
          <Button asChild variant="secondary" size="sm">
            <a href={GITHUB_REPO_URL} target="_blank" rel="noreferrer noopener">
              GitHub
            </a>
          </Button>
        </div>
      </SheetContent>
    </DialogRoot>
  );
}
