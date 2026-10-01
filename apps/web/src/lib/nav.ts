import {
  Boxes,
  Building2,
  FileText,
  FolderGit2,
  Gauge,
  History,
  Inbox,
  KeyRound,
  Languages,
  LayoutGrid,
  MessageSquare,
  Radar,
  Receipt,
  Rocket,
  Settings,
  TriangleAlert,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/**
 * The application's routes.
 *
 * `built` and `sample` were both written when there was no database, no
 * accounts and no organisations, and every route rendered either a not-built
 * screen or invented rows.
 *
 * **One route still carries `sample`, and one still carries `built: false`.**
 * `/` keeps both because its dashboard summarises runs, ambiguities and reviews
 * that nothing records — and it is reached only by a signed-out preview build,
 * since a signed-in reader is redirected to their workspace. `/settings` keeps
 * `built: false` because its controls would not work.
 *
 * Every other entry lost them, and they were lost late: `/ambiguity` in the PR
 * that made its surface real, `/review`, `/runs` and `/locales` on 2026-09-20,
 * by reading the screens rather than the file. A flag describing a screen has
 * no way to notice the screen changed, so it survives until somebody looks —
 * which is why the audit that found them looked at pixels, not at code.
 *
 * The information architecture (docs/product/03-information-architecture.md
 * §2) scopes these under `/{org}/{project}`. They are still flat because they
 * are inboxes — "what is waiting on me" spans workspaces, and the answering
 * happens on the project page where the run and its proposal are in view.
 */
export interface NavRoute {
  href: string;
  label: string;
  icon: LucideIcon;
  built: boolean;
  /**
   * Content is sample data, not this user's. Drives the breadcrumb chip.
   * Settings is deliberately false: it has controls that would not work, so
   * there is nothing to demonstrate.
   */
  sample?: boolean;
  /**
   * Count shown in the sidebar.
   *
   * **No route carries one today, and the field is kept rather than deleted so
   * the next one has a shape to fill.** Both routes that ever did — Ambiguity,
   * then Review — carried a literal, which is a number about somebody else's
   * workspace shown to everybody, and they were removed one at a time as each
   * was noticed. A real count needs a query per render and the sidebar does
   * none; whoever adds the query may have this back.
   *
   * The rule that outlives the field: a badge on Runs would be engagement bait.
   * Only a route where a human is blocked has earned one.
   */
  count?: number;
  /** What must exist before this screen can show anything real. */
  blockedBy?: string;
  /** Keywords for the command palette that are not in the label. */
  keywords?: string;
}

export const PRIMARY_NAV: NavRoute[] = [
  {
    href: '/',
    // Still sample, and still unbuilt — but for a narrower reason than before.
    //
    // Accounts and persisted projects now exist, so `/` no longer renders this
    // dashboard for a signed-in user: it routes them to their workspace. What
    // is unbuilt is the dashboard's *content* — the runs, ambiguities and
    // reviews it summarises — none of which is recorded anywhere yet.
    //
    // The sample dashboard survives for the preview build, where there is no
    // database at all. Marking this `built: true` on the strength of the
    // redirect would claim a screen that still has nothing real to show.
    sample: true,
    label: 'Home',
    icon: LayoutGrid,
    built: false,
    blockedBy:
      'Workspaces and projects exist now, so this routes you to yours. The summary itself needs runs, ambiguities and reviews, none of which are recorded yet.',
    keywords: 'overview dashboard start workspace',
  },
  {
    href: '/ambiguity',
    // No `count`. It was a hardcoded 3 rendered as a badge in the sidebar —
    // an invented number on every account, including one with nothing
    // waiting. A real count needs a query per render, which the sidebar does
    // not do; no badge is honest, a fixed one is not.
    label: 'Ambiguity',
    icon: TriangleAlert,
    built: true,
    keywords: 'questions decisions blocked unclear',
  },
  /*
   * The three entries below were `sample: true, built: false` until the visual
   * audit of 2026-09-20 read them off the screen.
   *
   * All three call `requireSession` and a query — `listReviewItemsForViewer`,
   * `listRunsForViewer`, `listLocaleCoverage` — and none renders `NotBuiltYet`.
   * `/runs` was wearing a SAMPLE chip over rows read from Postgres under RLS,
   * and its `blockedBy` read "Runs happen in your terminal today and are not
   * recorded anywhere a web page could read them" on a page that was reading
   * them. The flags outlived the screens they described, by PRs #19 to #22.
   *
   * `/ambiguity`, one entry above, was corrected when its own surface became
   * real and the other three were not. That is the shape of this defect: a
   * record updated where somebody looked, and left everywhere else.
   */
  {
    href: '/review',
    // No `count`. It was a hardcoded 3, rendered as the sidebar badge on every
    // account including one with nothing waiting — and until 2026-09-20 it was
    // also rendered to visitors with no session at all, because the shell was
    // drawn around the sign-in form. The comment on `/ambiguity` above rejected
    // exactly this number for exactly this reason, and the entry below it kept
    // it. A real count needs a query per render, which the sidebar does not do.
    label: 'Review',
    icon: FileText,
    built: true,
    keywords: 'approve suggestions copy editor',
  },
  {
    href: '/runs',
    label: 'Runs',
    icon: History,
    built: true,
    keywords: 'history jobs activity log',
  },
  {
    href: '/locales',
    label: 'Locales',
    icon: Languages,
    built: true,
    keywords: 'languages translations targets',
  },
];

/**
 * The component gallery, kept reachable and out of the customer's navigation.
 *
 * `/design` renders every primitive in `packages/ui` with its variants. It is
 * a development surface — useful, and not something a workspace owner has any
 * reason to find between Runs and Settings. The route is untouched and the
 * page still works; it simply stops being advertised.
 *
 * It stays in `ALL_ROUTES` below so the breadcrumb resolves when somebody
 * opens it directly. That is the difference between hiding a tool and
 * removing one.
 *
 * **This paragraph also said ⌘K still reached it by name, and that was the
 * last place it was advertised.** The palette renders for every signed-in
 * customer, so "out of the navigation" was true of the sidebar and false of
 * the menu beside it — the same entry, two surfaces, one of them overlooked.
 * `app-topbar.tsx` now filters `INTERNAL_NAV` out of the palette and an e2e
 * test searches for it and requires no result.
 */
export const INTERNAL_NAV: NavRoute[] = [
  {
    href: '/design',
    label: 'Design system',
    icon: Boxes,
    built: true,
    keywords: 'components gallery ui primitives tokens',
  },
];

export const SECONDARY_NAV: NavRoute[] = [
  {
    href: '/settings',
    label: 'Settings',
    icon: Settings,
    built: false,
    blockedBy:
      'There is no account, organisation, or project to configure yet.',
    keywords: 'preferences configuration account',
  },
];

/**
 * Closer — the operator's own sales tooling.
 *
 * A group of its own rather than entries mixed into `PRIMARY_NAV`, and it is
 * rendered only for a workspace that has Closer. Two reasons, and the second is
 * the one that matters: mixing "Leads" in beside "Runs" would tell a customer
 * that their localisation product has a sales pipeline, and the entries would
 * be present in the markup of every signed-in page whether or not the reader
 * may use them.
 *
 * Not in `ALL_ROUTES`. That list feeds the command palette and the breadcrumb,
 * both of which render for everybody — a Closer route surfacing in a customer's
 * ⌘K is the same leak by a quieter route.
 */
export const CLOSER_NAV: NavRoute[] = [
  {
    href: '/closer',
    label: 'Overview',
    icon: Radar,
    built: true,
    keywords: 'closer sales pipeline prospects',
  },
  {
    href: '/closer/companies',
    label: 'Companies',
    icon: Building2,
    built: true,
    keywords: 'closer prospects accounts discovery',
  },
  {
    href: '/closer/approvals',
    label: 'Approvals',
    icon: Inbox,
    built: true,
    keywords: 'closer outreach drafts approve review send',
  },
  {
    href: '/closer/replies',
    label: 'Replies',
    icon: MessageSquare,
    built: true,
    keywords: 'closer replies answers classify intent opt out',
  },
];

/**
 * The workspace's own surfaces, which the navigation did not contain.
 *
 * This is the defect the shell audit found, and it is larger than it looks. A
 * signed-in reader is redirected from `/` to `/{org}/projects` — and the
 * sidebar then offers Home, Ambiguity, Review, Runs, Locales, Design system and
 * Settings, none of which is the screen they just landed on. Projects, the
 * guided start, CLI tokens and usage were reachable only by typing a URL or by
 * following a link from inside another page.
 *
 * So the product a customer actually pays for was the one part of the product
 * the shell did not name. Everything else in this file is an inbox that spans
 * workspaces; these four belong to one, which is why they are a function of the
 * slug rather than a constant.
 *
 * `/{org}/billing` is deliberately absent. It renders "Paid plans are not
 * priced yet" and nothing else, and a permanent navigation entry for a screen
 * with nothing on it is an advertisement for a feature that does not exist.
 */
export function workspaceNav(orgSlug: string): NavRoute[] {
  return [
    {
      href: `/${orgSlug}/projects`,
      label: 'Projects',
      icon: FolderGit2,
      built: true,
      keywords: 'repository connect repo project target languages',
    },
    {
      href: `/${orgSlug}/start`,
      label: 'Set up',
      icon: Rocket,
      built: true,
      keywords: 'onboarding guided steps github connect first run start',
    },
    {
      href: `/${orgSlug}/tokens`,
      label: 'CLI tokens',
      icon: KeyRound,
      built: true,
      keywords: 'token cli personal authentication lit revoke',
    },
    {
      href: `/${orgSlug}/usage`,
      label: 'Usage',
      icon: Gauge,
      built: true,
      keywords: 'quota ceiling limit spend strings pull requests',
    },
  ];
}

/**
 * Every workspace route the breadcrumb must be able to name.
 *
 * `workspaceNav` is what the sidebar draws; this is what the topbar resolves
 * against, and the two differ by exactly one entry. Billing is deliberately
 * absent from the navigation — the reason is on `workspaceNav` above — but a
 * route reachable from the account menu still has to say where the reader is
 * when they get there. `/design` already works this way: out of the sidebar,
 * still resolvable.
 *
 * Hiding a destination and refusing to name it are different decisions, and
 * only the first one was ever taken.
 */
export function workspaceRoutes(orgSlug: string): NavRoute[] {
  return [
    ...workspaceNav(orgSlug),
    {
      href: `/${orgSlug}/billing`,
      label: 'Billing',
      icon: Receipt,
      built: false,
      blockedBy: 'No plan is priced yet, so there is nothing to bill for.',
      keywords: 'plan invoice subscription payment',
    },
  ];
}

export const ALL_ROUTES = [...PRIMARY_NAV, ...SECONDARY_NAV, ...INTERNAL_NAV];

export function routeByHref(href: string): NavRoute | undefined {
  return ALL_ROUTES.find((route) => route.href === href);
}

/**
 * Resolves any path, including a detail page, to the nav entry it belongs under.
 *
 * A detail route like `/runs/run-7c1b` is not in the nav list, so an exact
 * lookup returned nothing — which left run detail with no breadcrumb and, at the
 * time, no `Sample` chip either, on a page that was then full of sample data.
 *
 * The chip is gone from that path now: `/runs` reads Postgres, so the run and
 * its detail carry no marker. The breadcrumb reason stands on its own, and it
 * is the durable one — a detail page with no way back is a dead end whatever
 * its data is.
 *
 * Returns the deepest matching parent plus the trailing segment, so the
 * breadcrumb can read `Runs / 7c1b` and stay a way back rather than a label.
 *
 * ## The workspace routes, which it could not see
 *
 * `ALL_ROUTES` holds the flat inboxes and nothing else, so for six months the
 * breadcrumb on `/{org}/projects`, `/{org}/start`, `/{org}/tokens`,
 * `/{org}/usage` and `/{org}/billing` read "Layersky" and stopped. Measured
 * across all twelve routes: the five inboxes said "Layersky / Runs", and the
 * six surfaces a customer actually pays for said nothing. The half of the
 * product with the most navigating to do was the half with no trail.
 *
 * ## Why the slug is a parameter and not read from the path
 *
 * Because it must be the *validated* one. `shell-context.ts` already had to
 * fix this exact bug once, in the sidebar: a slug taken from the URL drew a
 * workspace's navigation on the 404 page of a workspace the reader is not in.
 * The breadcrumb naming a route inside someone else's workspace would be the
 * same assertion by a quieter route.
 *
 * So the caller passes the slug the layout resolved against `listOrganizations`
 * under RLS. Given `null`, or given a path inside a workspace that is not the
 * one resolved, no workspace route matches and the breadcrumb falls back to
 * the product name — which is the correct thing to say about a page the reader
 * cannot see.
 */
export function resolveRoute(
  pathname: string,
  /** The reader's validated workspace, never a slug taken from the URL. */
  orgSlug?: string | null,
): {
  route: NavRoute | undefined;
  detail?: string;
} {
  const candidates = orgSlug
    ? [...ALL_ROUTES, ...workspaceRoutes(orgSlug)]
    : ALL_ROUTES;

  const exact = candidates.find((route) => route.href === pathname);
  if (exact) return { route: exact };

  const parent = candidates
    .filter(
      (route) => route.href !== '/' && pathname.startsWith(`${route.href}/`),
    )
    // Deepest wins, so a future nested route does not resolve to a shallower one.
    .sort((a, b) => b.href.length - a.href.length)[0];

  if (!parent) return { route: undefined };

  const trailing = pathname.slice(parent.href.length + 1).split('/')[0];
  return { route: parent, detail: trailing?.replace(/^run-/, '') };
}
