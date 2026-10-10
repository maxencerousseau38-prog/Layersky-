/**
 * Where the shared sign-in is stored, and who it belongs to.
 *
 * Its own module because Playwright refuses to let one test file import
 * another — auth.setup.ts writes this file and data-surface.spec.ts reads it,
 * and neither may name the other. The constants have to live somewhere both can
 * reach, and duplicating them is how the account and the path drift apart.
 *
 * Gitignored: it holds a real (development) session token.
 */
export const STORAGE_STATE = 'e2e/.auth/acceptance.json';

/** The seeded account, verbatim from supabase/seeds/dev-user.sql. */
export const SEEDED_EMAIL = 'acceptance@localize-infra.dev';
export const SEEDED_PASSWORD = 'acceptance-test-pw-8chars';

/**
 * A second seeded identity: authenticated, and outside Closer.
 *
 * It owns `intruder-co`, a different organization with no `closer_workspaces`
 * row, which is what makes it the right subject for the refusal test —
 * `hasCloser()` reads that table under RLS, so a user whose organizations hold
 * no row sees nothing and the layout answers 404.
 *
 * Also verbatim from supabase/seeds/dev-user.sql. No session is cached for it:
 * one test signs in, where the shared state exists to spare eighteen tests
 * from doing so.
 */
export const OUTSIDER_EMAIL = 'intruder@localize-infra.dev';
export const OUTSIDER_PASSWORD = 'intruder-test-pw-8chars';

/**
 * A third seeded identity: a member of the very workspace Closer runs in.
 *
 * The harder case than the outsider, and the one the authorisation change is
 * about. This account is a `member` of `acceptance`, which is the organization
 * `closer_workspaces` designates — so until
 * `20261010000100_closer_operators.sql` it could read the whole pipeline and
 * call every Closer write function, because both gated on
 * `is_org_member(organization_id)`.
 *
 * The seed deliberately gives it **no** `closer_operators` grant. If it ever
 * gets one, the refusal tests below stop testing anything.
 */
export const MEMBER_EMAIL = 'member@localize-infra.dev';
export const MEMBER_PASSWORD = 'member-test-pw-12chars';
