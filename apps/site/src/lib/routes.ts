/**
 * Every public route, in one place.
 *
 * The sitemap is generated from this list rather than maintained beside it, so
 * a new page cannot be added to the navigation and quietly left out of the
 * sitemap — which is the usual way sitemaps rot.
 */
export const PUBLIC_ROUTES = [
  { path: '/', priority: 1 },
  { path: '/docs', priority: 0.9 },
  { path: '/benchmarks', priority: 0.8 },
  { path: '/quality', priority: 0.8 },
  { path: '/security', priority: 0.7 },
  { path: '/pricing', priority: 0.7 },
  { path: '/roadmap', priority: 0.5 },
  /*
   * The pages a first external team needs before installing anything, and
   * which this site did not have: what you are agreeing to, what is held
   * about you, and where a problem goes. Low priority because nobody
   * searches for them — but in the sitemap, because they are findable
   * exactly when somebody is deciding whether to trust this.
   */
  { path: '/terms', priority: 0.3 },
  { path: '/privacy', priority: 0.3 },
  { path: '/contact', priority: 0.3 },
] as const;

/**
 * The origin the site publishes itself under: canonical tags, `metadataBase`,
 * the sitemap and the robots record all derive from it.
 *
 * This was `https://localize-infra.dev` for as long as nothing was deployed,
 * and that domain was never registered — it has no DNS record at all. Once the
 * site went live, every page was telling search engines its canonical address
 * was a host that does not resolve, and the sitemap advertised seven more.
 * Nothing caught it because a canonical tag is not wrong in any way a build,
 * a type check or a rendered page can show.
 *
 * So it names the origin actually serving the site. When a custom domain is
 * attached, this is the single line that changes — and `docs/deploying.md`
 * carries a smoke check for exactly the failure above.
 */
export const SITE_URL = 'https://localize-infra-site.vercel.app';
