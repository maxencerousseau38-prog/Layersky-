'use client';

import { SampleChip } from '@/components/sample';
import { Separator } from '@/components/ui/separator';
import { SidebarTrigger } from '@/components/ui/sidebar';
import {
  ALL_ROUTES,
  INTERNAL_NAV,
  resolveRoute,
  workspaceNav,
} from '@/lib/nav';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
  type CommandItem,
  CommandPalette,
  ThemeToggle,
  cn,
  setTheme,
  useCommandPaletteHotkey,
} from '@localize-infra/ui';
import {
  BookOpen,
  // The same icon `ThemeToggle` gives OLED, so the two controls that offer the
  // scheme do not each invent a glyph for it.
  Contrast,
  GitBranch,
  Monitor,
  Moon,
  Search,
  Sun,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import * as React from 'react';

/**
 * 48px top bar (layout contract, docs/product/04-wireframes.md §0).
 *
 * Breadcrumb left, ⌘K search centre, theme control right, plus the navigation
 * trigger below 1024px. There is no global "New" button: creation happens in
 * the terminal, and a prominent web CTA would contradict the product's shape.
 */
export function AppTopbar({
  /**
   * The reader's validated workspace, resolved in the root layout against
   * their memberships — never the slug in the address bar. It is what lets the
   * breadcrumb name `/{org}/projects`, and passing it rather than deriving it
   * here is the whole reason a non-member cannot make this bar label a
   * workspace they cannot see.
   */
  orgSlug,
}: { orgSlug: string | null }) {
  const pathname = usePathname();
  const router = useRouter();
  const [paletteOpen, setPaletteOpen] = React.useState(false);

  useCommandPaletteHotkey(() => setPaletteOpen((open) => !open));

  const { route: current, detail } = resolveRoute(pathname, orgSlug);

  const items: CommandItem[] = React.useMemo(
    () => [
      /*
       * The workspace's own surfaces, first, because they are where the work
       * is. Absent entirely for a reader with no workspace: an entry that
       * needs a slug cannot be offered without one.
       */
      ...(orgSlug ? workspaceNav(orgSlug) : []).map((route) => ({
        id: route.href,
        label: route.label,
        section: 'Workspace',
        icon: route.icon,
        keywords: route.keywords,
        onSelect: () => router.push(route.href),
      })),

      /*
       * `/design` is filtered out, and this is the last place it was still
       * advertised.
       *
       * `INTERNAL_NAV` exists so the gallery is reachable and unlisted, and
       * the sidebar honours that. `ALL_ROUTES` folds it back in — which is
       * right for the breadcrumb, because a reader who opens `/design`
       * directly still needs to be told where they are, and wrong for this
       * list, which is a menu a customer opens with ⌘K.
       *
       * The route is untouched: typing the URL still works, and so does the
       * breadcrumb on it. Only the advertisement is gone.
       */
      ...ALL_ROUTES.filter(
        (route) =>
          !INTERNAL_NAV.some((internal) => internal.href === route.href),
      ).map((route) => ({
        id: route.href,
        label: route.label,
        section: 'Navigation',
        icon: route.icon,
        keywords: route.keywords,
        onSelect: () => router.push(route.href),
      })),

      // Every entry below actually runs. Extraction, translation, opening a
      // pull request and approving a suggestion are all absent, deliberately:
      // they need a backend, and a palette that offers a command it cannot run
      // is worse than one that offers fewer. Theme and external references are
      // the actions that genuinely work today.
      {
        id: 'theme-light',
        label: 'Switch to light theme',
        section: 'Actions',
        icon: Sun,
        keywords: 'appearance colour scheme bright',
        onSelect: () => setTheme('light'),
      },
      {
        id: 'theme-dark',
        label: 'Switch to dark theme',
        section: 'Actions',
        icon: Moon,
        keywords: 'appearance colour scheme night',
        onSelect: () => setTheme('dark'),
      },
      /*
       * OLED, which this list had been missing since the scheme shipped.
       *
       * `ThemeToggle` — the control sitting a few pixels to the right of the
       * button that opens this palette — has offered four schemes all along.
       * The palette offered three, so the same surface disagreed with itself
       * about how many themes the product has, and the one it omitted was the
       * one added most recently. `docs/design/05-design-system.md` §4.6 calls
       * this the primary navigation; a scheme reachable only from the toggle is
       * a scheme half the readers never find.
       *
       * Placed after `dark` rather than at the end, because it is a refinement
       * of it (§6.4) and the list reads as an ordering of grounds.
       */
      {
        id: 'theme-oled',
        label: 'Switch to OLED theme',
        section: 'Actions',
        icon: Contrast,
        keywords: 'appearance colour scheme black amoled dark true',
        onSelect: () => setTheme('oled'),
      },
      {
        id: 'theme-system',
        label: 'Match system theme',
        section: 'Actions',
        icon: Monitor,
        keywords: 'appearance colour scheme auto os',
        onSelect: () => setTheme('system'),
      },

      {
        id: 'help-docs',
        label: 'Read the documentation',
        section: 'Help',
        icon: BookOpen,
        keywords: 'cli flags init guide',
        // The marketing site's origin, spelled out because `apps/web` cannot
        // import from `apps/site`. It pointed at `localize-infra.dev` — a
        // domain that was never registered — so this entry opened a blank tab.
        // Keep in step with `SITE_URL` in apps/site/src/lib/routes.ts.
        onSelect: () =>
          window.open('https://localize-infra-site.vercel.app/docs', '_blank'),
      },
      {
        id: 'help-repo',
        label: 'Open the repository',
        section: 'Help',
        icon: GitBranch,
        keywords: 'source github code',
        onSelect: () =>
          window.open(
            'https://github.com/maxencerousseau38-prog/localize-infra',
            '_blank',
          ),
      },
      /*
       * "See an example pull request" is gone, and it was a 404 for every
       * reader.
       *
       * It opened `localize-infra-fixture-vite/pull/1`. That repository is
       * private, so the link resolved for the owner and for nobody else —
       * the identical defect CLAUDE.md records on the landing page, where it
       * survived four copies because everyone who checked was signed in to
       * GitHub as the owner. The site's fix was `EXAMPLE_PR_URL = null` plus
       * an e2e guard forbidding links into the fixture; `apps/web` was never
       * swept, so the last copy lived on in this palette.
       *
       * Removed rather than repointed: there is no public pull request to
       * offer, and this file's own rule two blocks up is that a palette
       * offering a command it cannot run is worse than one offering fewer.
       * Making the fixture public would bring it back in one line.
       */
    ],
    [router, orgSlug],
  );

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line px-4">
      {/* The sidebar owns its own mobile presentation now, so the second copy
          of the navigation that used to live in this bar — a Dialog wrapping a
          duplicate of the sidebar's links — is gone. This trigger toggles the
          rail on desktop and opens the sheet on a phone, and SidebarProvider
          binds ⌘B to it. */}
      <SidebarTrigger className="-ms-1" />
      <Separator orientation="vertical" className="me-1 h-4" />

      {/* The shared Breadcrumb primitive rather than a local `nav > ol`. The
          hand-rolled version never marked the current segment with
          `aria-current="page"`, so a screen reader heard the trail but not
          which part of it was here — the one thing a breadcrumb exists to
          say. */}
      <Breadcrumb className="min-w-0 flex-1">
        <BreadcrumbList>
          {/* The root segment is dropped on narrow screens rather than
              truncated: the last segment is the one that says where you are. */}
          <BreadcrumbItem className="hidden sm:inline-flex">
            Layersky
          </BreadcrumbItem>
          {current ? (
            <>
              <BreadcrumbSeparator className="hidden sm:inline-flex">
                /
              </BreadcrumbSeparator>
              {/* On a detail page the parent stays a link, so the breadcrumb
                  is a way back rather than a label. */}
              <BreadcrumbItem className="truncate">
                {detail ? (
                  <Link
                    href={current.href}
                    className="rounded-sm text-secondary hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                  >
                    {current.label}
                  </Link>
                ) : (
                  <BreadcrumbPage>{current.label}</BreadcrumbPage>
                )}
              </BreadcrumbItem>
              {detail ? (
                <>
                  <BreadcrumbSeparator>/</BreadcrumbSeparator>
                  <BreadcrumbItem className="truncate">
                    <BreadcrumbPage className="font-mono">
                      {detail}
                    </BreadcrumbPage>
                  </BreadcrumbItem>
                </>
              ) : null}
              {/* Third of the three sample markers. Present on every sample
                  route, so a reader who lands mid-app still sees it. */}
              {current.sample ? (
                <BreadcrumbItem>
                  <SampleChip />
                </BreadcrumbItem>
              ) : null}
            </>
          ) : null}
        </BreadcrumbList>
      </Breadcrumb>

      <button
        type="button"
        onClick={() => setPaletteOpen(true)}
        className={cn(
          'flex h-7 shrink-0 items-center gap-2 rounded-md border border-line bg-surface px-2.5',
          'text-small text-tertiary',
          'transition-colors duration-(--duration-micro) hover:text-secondary',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
        )}
      >
        <Search className="size-3.5" aria-hidden="true" />
        <span className="sr-only sm:not-sr-only">Search</span>
        {/* The shortcut is shown, not hidden: a palette nobody knows about is a
            palette nobody uses. Hidden where there is no keyboard to press it
            with. */}
        {/* `text-secondary`, not tertiary: at 11px this measured 4.54:1, which
            clears AA by four hundredths — a coincidence rather than a margin,
            and this is the one affordance telling a reader the palette exists. */}
        <kbd className="hidden font-mono text-micro text-secondary sm:inline">
          ⌘K
        </kbd>
      </button>

      <ThemeToggle />

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        items={items}
      />
    </header>
  );
}
