'use client';

import { NavAccount } from '@/components/nav-account';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarSeparator,
  useSidebar,
} from '@/components/ui/sidebar';
import {
  type NavRoute,
  PRIMARY_NAV,
  SECONDARY_NAV,
  workspaceNav,
} from '@/lib/nav';
import { FlaskConical } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * The application shell's navigation, built on shadcn's Sidebar.
 *
 * This replaces a hand-rolled 240px column plus a separate sheet in the topbar
 * that duplicated the same links. What the shadcn component brings is not
 * styling — every colour here is a Localize Infra token — but behaviour that
 * was never going to be written by hand and kept correct: collapse to an icon
 * rail, a ⌘B shortcut, the collapsed state persisted across sessions, the rail
 * as a drag target, and an automatic Sheet presentation below the mobile
 * breakpoint with its own focus management.
 *
 * The identity work is in the mapping: `--sidebar` resolves to our surface,
 * `--sidebar-accent` to our active ground, `--sidebar-ring` to the Iris focus
 * ring. shadcn's generated defaults shipped a blue ring, which this product's
 * colour discipline does not allow.
 */
function NavItem({
  route,
  collapsedLabel,
}: { route: NavRoute; collapsedLabel: string }) {
  const pathname = usePathname();
  const { setOpenMobile } = useSidebar();
  const active =
    route.href === '/' ? pathname === '/' : pathname.startsWith(route.href);
  const Icon = route.icon;

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        asChild
        isActive={active}
        tooltip={collapsedLabel}
        className="data-[active=true]:font-medium"
      >
        <Link
          href={route.href}
          aria-current={active ? 'page' : undefined}
          // On a phone the navigation is a sheet over the page. shadcn does not
          // dismiss it on selection, so without this the reader arrives at the
          // new route with the menu still covering it.
          onClick={() => setOpenMobile(false)}
        >
          <Icon aria-hidden="true" />
          <span className="truncate">{route.label}</span>
          {/* No route carries a count today — Ambiguity lost its literal when
              its surface became real, Review lost the same literal on
              2026-09-20 — so this branch renders for nobody. Kept because the
              shape is right for the first real count: dashed rather than solid,
              and hidden when the rail collapses, where the tooltip carries the
              number instead. See the `count` field in lib/nav.ts. */}
          {route.count !== undefined ? (
            <span className="ms-auto rounded-sm border border-dashed border-strong px-1.5 font-mono text-micro tabular-nums text-tertiary group-data-[collapsible=icon]:hidden">
              {route.count}
            </span>
          ) : null}
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

export function AppSidebar({
  sampleData,
  orgSlug,
  account,
}: {
  sampleData: boolean;
  /**
   * The workspace whose surfaces the navigation names, or null.
   *
   * Null for a reader with no workspace yet — during sign-up, and in the
   * preview build with no database. The group is then not rendered at all
   * rather than rendered with dead links: a navigation entry that 404s is
   * worse than an absent one, because it looks like the product is broken
   * rather than like it has not started.
   */
  orgSlug: string | null;
  /** The signed-in address, or null when nobody is. */
  account: string | null;
}) {
  return (
    <Sidebar collapsible="icon" className="border-e border-line">
      <SidebarHeader className="h-12 justify-center px-3">
        <Link
          href="/"
          /*
           * The display face, and one step up.
           *
           * Measured before it was changed: the wordmark was 14px/600 Inter and
           * a navigation label is 14px/400 Inter — same size, same face, one
           * weight apart. §3.5 is about hierarchy contrast and names that
           * failure exactly; the product's own name ranked against a link by a
           * single step.
           *
           * Archivo is the other half. It renders every page title in this
           * application — `PageHeader` uses `font-display` — and appeared
           * nowhere in the shell, so the frame and the pages inside it had no
           * typographic voice in common. `subtitle` puts the mark one step
           * above the navigation and two below an h1, which is the ranking it
           * should have had.
           */
          className="flex items-center gap-2.5 rounded-md font-display text-subtitle font-semibold text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          {/* The mark: three rules of descending width, echoing the State Rule
              the product uses to carry confidence. Graphite throughout — Iris
              means one thing here and chrome does not get to borrow it. */}
          <span
            aria-hidden="true"
            className="flex size-4 shrink-0 flex-col justify-between py-[1px]"
          >
            <span className="block h-[2px] w-full rounded-full bg-primary" />
            <span className="block h-[2px] w-3/4 rounded-full bg-strong" />
            <span className="block h-[2px] w-1/2 rounded-full bg-line" />
          </span>
          <span className="truncate group-data-[collapsible=icon]:hidden">
            Layersky
          </span>
        </Link>
      </SidebarHeader>

      {/* shadcn's SidebarContent is a plain div, so wrapping the groups in a
          nav restores the single "Main" landmark this application has always
          exposed. Without it the sidebar is a pile of links with no landmark
          to jump to, which is a regression a screen-reader user would feel
          immediately and a sighted reviewer would never see. */}
      <SidebarContent>
        <nav aria-label="Main" className="flex min-h-0 flex-1 flex-col gap-2">
          {/*
           * The workspace's own surfaces, which this navigation did not have.
           *
           * A signed-in reader is redirected from `/` to `/{org}/projects`, and
           * the sidebar then offered Home, Ambiguity, Review, Runs, Locales,
           * Design system and Settings — none of which is the screen they had
           * just landed on. Projects, the guided set-up, CLI tokens and usage
           * were reachable only by typing a URL.
           *
           * So the part of the product a customer pays for was the one part the
           * shell did not name. It goes first because it is where the work
           * starts; the group below it is the set of inboxes, which span
           * workspaces and answer "what is waiting on me".
           */}
          {orgSlug ? (
            <>
              <SidebarGroup>
                <SidebarGroupLabel>Workspace</SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {workspaceNav(orgSlug).map((route) => (
                      <NavItem
                        key={route.href}
                        route={route}
                        collapsedLabel={route.label}
                      />
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>

              <SidebarSeparator />
            </>
          ) : null}

          <SidebarGroup>
            <SidebarGroupLabel>Pipeline</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {PRIMARY_NAV.map((route) => (
                  <NavItem
                    key={route.href}
                    route={route}
                    collapsedLabel={
                      route.count !== undefined
                        ? `${route.label} (${route.count})`
                        : route.label
                    }
                  />
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>

          <SidebarSeparator />

          <SidebarGroup>
            <SidebarGroupLabel>System</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {SECONDARY_NAV.map((route) => (
                  <NavItem
                    key={route.href}
                    route={route}
                    collapsedLabel={route.label}
                  />
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </nav>
      </SidebarContent>

      {/*
       * This note has now been wrong twice, in opposite directions.
       *
       * It first read "No project connected. Everything shown is sample data."
       * — correct when nothing was real, and false once the workspace, its
       * projects and its runs began reading the database. It was narrowed to
       * "The screens listed above show sample data. Your workspace, projects
       * and runs are real", with a comment stating that the routes in the nav
       * above "genuinely are still stubs".
       *
       * They are not. `/ambiguity`, `/review`, `/runs` and `/locales` all call
       * `requireSession` and query Postgres; `nav.ts` carried `sample: true` on
       * three of them until the flags were corrected against the screens. Only
       * `/` renders a sample dashboard, and a signed-in reader never reaches it
       * — `app/page.tsx` redirects them to their workspace. So for every reader
       * with a session, the sentence claimed that five real surfaces were
       * invented.
       *
       * The second half was no better: with no database there is nothing real
       * to reassure anybody about, so "your workspace, projects and runs are
       * real" was false in exactly the case the note was meant for.
       *
       * The note's own first comment says why this matters: a banner asserting
       * that real data is invented is the same defect as presenting invented
       * data as real, pointing the other way. It is now shown only where it is
       * true — no database — and says what is actually on screen there.
       */}
      <SidebarFooter className="gap-2">
        {/*
         * The note keeps its own visibility rule — it is about the data, not
         * about the reader — while the account below is about the reader and
         * shows whenever there is one. They were one block; separating them
         * means the preview build still explains itself and a signed-in
         * workspace is not told its real data is invented.
         */}
        {sampleData ? (
          <div className="flex items-start gap-2 rounded-md border border-dashed border-strong px-2.5 py-2 group-data-[collapsible=icon]:hidden">
            <FlaskConical
              className="mt-0.5 size-3.5 shrink-0 text-tertiary"
              aria-hidden="true"
              strokeWidth={1.5}
            />
            <p className="text-micro leading-4 text-tertiary">
              No database is connected here. Home shows a sample dashboard;
              every other screen says it has nothing to read.
            </p>
          </div>
        ) : null}

        {account ? <NavAccount email={account} orgSlug={orgSlug} /> : null}
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}
