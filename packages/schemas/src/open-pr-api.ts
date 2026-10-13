import { z } from 'zod';

// This service's only legitimate purpose is writing locale JSON files, so
// path validation is a positive allowlist rather than a denylist: every path
// segment must match a restrictive safe-character set, the path must end
// in `.json`, and the path must start with one of `CORRECTABLE_LOCALE_DIRS`,
// compared segment by segment. This is stricter than (and subsumes)
// simply rejecting `..`/`.` segments, absolute POSIX paths, and absolute
// Windows paths (drive letters like `C:\` or `C:/`) — a pure traversal
// denylist still lets a caller steer the PR at arbitrary in-repo files like
// `.github/workflows/malicious.yml` or `package.json`, which don't traverse
// outside the repo but are still far outside the intended locale directory.
// The traversal-specific checks are kept below for defense-in-depth/clarity
// even though the segment allowlist, `.json` suffix requirement, and
// root restriction already rule them out. Backslashes are
// rejected outright rather than treated as a separator: git tree paths are
// always forward-slash-separated regardless of OS, so no legitimate path
// needs one, and a backslash could otherwise be used to smuggle a traversal
// segment past the `/`-based split below (e.g. `locales\..\..\secret.json`).
const SAFE_PATH_SEGMENT = /^[A-Za-z0-9._-]+$/;

/**
 * The catalogue directories a pull request may write into — exactly the ones
 * the i18next loader reads (`packages/core/src/i18n/catalogue.ts`), in the same
 * order.
 *
 * It was `locales` alone, the literal every legacy framework detector uses.
 * The health check reads `public/locales` and `src/locales` too, so a
 * repository could be analysed and never corrected; on twelve public i18next
 * projects measured, none kept its catalogues in a root `locales/`. Each entry
 * is still an exact root, so `contents: write` reaches catalogue JSON and
 * nothing beside it — `public/manifest.json` and `src/config.json` stay out.
 *
 * Exported so a caller deciding "correctable" — `apps/web`'s
 * `correctableDirectory` — can read this list instead of keeping a second copy
 * that could disagree with what this schema accepts.
 */
export const CORRECTABLE_LOCALE_DIRS = [
  'public/locales',
  'locales',
  'src/locales',
] as const;

/** Whether `segments` begins with `root`'s segments and continues past it. */
function startsWithRoot(segments: readonly string[], root: string): boolean {
  const rootSegments = root.split('/');
  return (
    segments.length > rootSegments.length &&
    rootSegments.every((segment, index) => segments[index] === segment)
  );
}

function isSafeRelativePath(path: string): boolean {
  if (path.length === 0 || path.trim().length === 0) return false;
  if (path.includes('\0')) return false;
  if (path.includes('\\')) return false;
  if (path.startsWith('/')) return false;
  if (/^[a-zA-Z]:/.test(path)) return false;
  if (!path.endsWith('.json')) return false;
  const segments = path.split('/');
  if (!CORRECTABLE_LOCALE_DIRS.some((root) => startsWithRoot(segments, root))) {
    return false;
  }
  return segments.every(
    (segment) =>
      segment !== '.' && segment !== '..' && SAFE_PATH_SEGMENT.test(segment),
  );
}

export const OpenPrFileSchema = z.object({
  path: z.string().min(1).refine(isSafeRelativePath, {
    message:
      'path must be a relative, forward-slash-separated path under "public/locales/", "locales/" or "src/locales/" ending in ".json", with every segment restricted to [A-Za-z0-9._-] and no "." or ".." segments, leading "/", or drive letter',
  }),
  content: z.string(),
});

// `owner`/`repo` flow directly into Octokit URL templates (e.g.
// `GET /repos/{owner}/{repo}`), so they're restricted to the character set
// GitHub actually allows in those slugs. `baseBranch` is a git ref name,
// which is otherwise fairly permissive (slashes are common, e.g.
// `release/1.0`), so it's only blocked from whitespace and null bytes rather
// than constrained to a narrow allowlist.
const OWNER_REPO_PATTERN = /^[A-Za-z0-9._-]+$/;
const NO_WHITESPACE_OR_NULL_PATTERN = /^[^\s\0]+$/;

export const OpenPrApiRequestSchema = z.object({
  owner: z.string().min(1).regex(OWNER_REPO_PATTERN),
  repo: z.string().min(1).regex(OWNER_REPO_PATTERN),
  baseBranch: z.string().min(1).regex(NO_WHITESPACE_OR_NULL_PATTERN),
  title: z.string().min(1),
  body: z.string(),
  files: z.array(OpenPrFileSchema).min(1),
  /*
   * Which App installation should open the pull request.
   *
   * There was no such field, and that was a self-serve blocker rather than a
   * missing convenience. A multi-tenant caller resolves an installation per
   * workspace to *read* the repository, then had no way to say so when
   * *writing*: the service opened every tenant's pull request through the one
   * installation named by its own `GITHUB_APP_INSTALLATION_ID`. A customer who
   * connected their own installation would translate successfully and fail at
   * the pull request, because the operator's installation does not reach their
   * repository.
   *
   * Optional, and the optionality is the point rather than leniency. Two
   * callers with different shapes share this route:
   *
   *   - a multi-tenant deployment (`apps/web`) knows the workspace and MUST
   *     send its installation, so the write uses the same one as the read;
   *   - a self-hosted single-tenant deployment (`packages/cli` against an
   *     `apps/api` the same person runs) has exactly one installation and no
   *     concept of choosing between them. Requiring the field would break it
   *     for no gain — there is nothing there to isolate from.
   *
   * Omitted, the service falls back to its configured default. That fallback is
   * a real limit and is written down rather than implied: the service trusts
   * whoever holds its bearer token to name the correct installation. It does
   * not know which tenant is calling, so it cannot check. What it does enforce
   * is GitHub's own boundary — an installation token only reaches repositories
   * that installation was granted, so naming one that cannot reach `owner/repo`
   * fails rather than succeeding somewhere unintended.
   */
  installationId: z.number().int().positive().optional(),
});
export type OpenPrApiRequest = z.infer<typeof OpenPrApiRequestSchema>;

export const OpenPrApiResponseSchema = z.object({
  prUrl: z.string().url(),
  prNumber: z.number().int().positive(),
});
export type OpenPrApiResponse = z.infer<typeof OpenPrApiResponseSchema>;
