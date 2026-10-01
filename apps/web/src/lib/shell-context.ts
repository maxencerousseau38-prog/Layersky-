import 'server-only';
import { listOrganizations } from '@/lib/data/workspace';
import { isSupabaseConfigured } from '@/lib/supabase/env';
import { createClient } from '@/lib/supabase/server';

/**
 * What the shell needs to know about the reader, and nothing more.
 *
 * ## Why this is not `requireSession`
 *
 * `requireSession` redirects when there is no session, which is right for a
 * page and wrong for the chrome around it. The root layout renders for the
 * preview build with no database at all, and redirecting from there would turn
 * a demonstrable product into a redirect loop. **Everything here answers null
 * instead of throwing**, and the shell renders the parts it can.
 *
 * ## Why the slug comes from the path first
 *
 * A reader can belong to several workspaces. The one whose surfaces the
 * navigation should name is the one they are looking at, which the path says
 * exactly — and only when the path says nothing does the first membership
 * stand in. Deriving it from the membership list alone would highlight the
 * wrong workspace for anybody in two, silently and on every page.
 *
 * The slug is taken from the URL rather than looked up, and that is safe
 * because nothing is authorised on it: it decides which links to draw, and
 * every one of those pages re-reads the workspace under RLS. A slug that is
 * not the reader's produces links that 404 for them, which is what it should
 * do — `findOrganization` returns null for a workspace that exists but is not
 * yours, deliberately, so the two cases cannot be told apart.
 */
export interface ShellContext {
  /** The signed-in address, or null when nobody is. */
  account: string | null;
  /** The workspace the navigation should name, or null. */
  orgSlug: string | null;
}

const EMPTY: ShellContext = { account: null, orgSlug: null };

/**
 * Path segments that are routes rather than workspace slugs.
 *
 * `/{org}` and `/runs` are the same shape, so the first segment of `/runs/x`
 * would read as a workspace called "runs" and the navigation would offer
 * `/runs/projects`. Listed rather than inferred: a new top-level route added
 * without a thought here draws four dead links, and the test beside this file
 * is what notices.
 */
const RESERVED_SEGMENTS = new Set([
  'ambiguity',
  'api',
  'auth',
  'closer',
  'design',
  'github',
  'locales',
  'login',
  'onboarding',
  'review',
  'runs',
  'settings',
]);

/** The workspace slug a path is inside, or null. Pure, so it is testable. */
export function orgSlugFromPath(pathname: string | null): string | null {
  if (!pathname) return null;
  const first = pathname.split('/').filter(Boolean)[0];
  if (!first || RESERVED_SEGMENTS.has(first)) return null;
  return first;
}

export async function readShellContext(
  pathname: string | null,
): Promise<ShellContext> {
  if (!isSupabaseConfigured()) return EMPTY;

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user?.email) return EMPTY;

    /*
     * The slug is checked against the reader's memberships, not trusted.
     *
     * It was taken straight from the URL, with a comment arguing that was safe
     * because every workspace page re-reads under RLS. The pages are safe; the
     * *shell* was not. Visiting `/someone-elses-workspace/projects` produced a
     * 404 page wearing a navigation group of four links into a workspace the
     * reader cannot see — the product asserting that something exists, on the
     * one screen whose whole job is to say it does not.
     *
     * Found by the e2e suite, which tranche 1 shipped without running: three
     * "is a 404, not a 403" tests went red and stayed red through a second
     * tranche. `listOrganizations` reads under RLS and returns only what the
     * reader belongs to, so an unknown slug simply finds no match.
     */
    const organizations = await listOrganizations();
    const fromPath = orgSlugFromPath(pathname);
    const owned = organizations.some((o) => o.slug === fromPath);

    return {
      account: user.email,
      // The workspace being looked at when it is the reader's, else their
      // first. Never a slug taken from the URL on trust.
      orgSlug: (owned ? fromPath : organizations[0]?.slug) ?? null,
    };
  } catch {
    /*
     * The shell must render even when this fails.
     *
     * This runs in the root layout, so throwing here replaces every page in
     * the application with an error — including the ones that would have
     * worked. A reader who loses the workspace group still has the pipeline
     * navigation and their content; a reader who loses the layout has nothing.
     */
    return EMPTY;
  }
}
