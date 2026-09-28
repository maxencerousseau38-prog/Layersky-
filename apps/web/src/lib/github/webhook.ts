import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Who is allowed to start work, and on what.
 *
 * A webhook endpoint is the only surface in this product that an unauthenticated
 * stranger can reach and cause compute with. Everything that decides whether to
 * act lives here, as pure functions over the raw body and headers, so the
 * decisions are testable without a server and so there is one place to read
 * when asking "what can make this run?".
 *
 * The route handler does IO. This file does judgement.
 */

/**
 * Verify GitHub's signature over the raw body.
 *
 * **The raw body, not the parsed one.** `JSON.parse` followed by
 * `JSON.stringify` does not round-trip byte for byte — key order, unicode
 * escapes and number formatting all move — so a signature checked against
 * re-serialised JSON fails for honest requests and, worse, invites someone to
 * "fix" it by checking a normalised form. The handler reads `req.text()` once
 * and passes that string here.
 *
 * `timingSafeEqual` rather than `===`, and the length is checked first because
 * `timingSafeEqual` throws on a length mismatch instead of returning false.
 */
export function verifySignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
): boolean {
  if (!signatureHeader || !secret) return false;

  const expected = `sha256=${createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')}`;

  const a = Buffer.from(signatureHeader, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** The pull_request events worth analysing. */
const ANALYSED_ACTIONS = new Set(['opened', 'synchronize', 'reopened']);

/**
 * Branch prefix this product opens its own pull requests under.
 *
 * `services/github-app/src/open-pr.ts` creates
 * `localize-infra/add-translations-<timestamp>`. Matching the prefix rather
 * than the full name is deliberate: the suffix is a timestamp, so an exact
 * match would only ever catch a branch that no longer exists.
 */
const OWN_BRANCH_PREFIX = 'localize-infra/';

export type WebhookDecision =
  | { act: false; reason: string }
  | {
      act: true;
      owner: string;
      repo: string;
      installationId: number;
      pullNumber: number;
      headSha: string;
      headRef: string;
    };

/** The slice of the payload this reads. Narrow on purpose. */
interface PullRequestEvent {
  action?: unknown;
  installation?: { id?: unknown };
  repository?: { name?: unknown; owner?: { login?: unknown } };
  pull_request?: {
    number?: unknown;
    draft?: unknown;
    head?: { sha?: unknown; ref?: unknown };
    user?: { type?: unknown };
  };
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}
function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Decide whether an event should start an analysis.
 *
 * Every refusal carries a reason rather than a bare false, because these are
 * the sentences that will be read when somebody asks why their pull request
 * got no check — and "it returned false" is not an answer anyone can act on.
 */
export function decideWebhook(
  eventName: string | null,
  payload: unknown,
): WebhookDecision {
  if (eventName !== 'pull_request') {
    return { act: false, reason: `ignored event: ${eventName ?? 'none'}` };
  }
  if (typeof payload !== 'object' || payload === null) {
    return { act: false, reason: 'payload is not an object' };
  }

  const event = payload as PullRequestEvent;
  const action = str(event.action);
  if (!action || !ANALYSED_ACTIONS.has(action)) {
    return { act: false, reason: `ignored action: ${action ?? 'none'}` };
  }

  const headRef = str(event.pull_request?.head?.ref);

  /*
   * Loop prevention, and it comes before anything expensive.
   *
   * This product opens pull requests of its own. Analysing one would be a
   * machine reviewing its own output, and — once a correction step exists —
   * could open a pull request in response to a pull request, indefinitely. The
   * branch prefix is the cheapest reliable signal: it is set by our own code
   * and requires no extra API call to read.
   */
  if (headRef?.startsWith(OWN_BRANCH_PREFIX)) {
    return { act: false, reason: `own branch: ${headRef}` };
  }

  /*
   * A second, independent guard. A bot account opening a branch that does not
   * carry our prefix is still not a person asking for a review, and pairing two
   * unrelated signals is what stops a rename of the prefix from silently
   * removing the protection.
   */
  if (str(event.pull_request?.user?.type) === 'Bot') {
    return { act: false, reason: 'pull request opened by a bot' };
  }

  // A draft is work in progress. Checking it spends compute on something the
  // author has said is not ready, on every push.
  if (event.pull_request?.draft === true) {
    return { act: false, reason: 'draft pull request' };
  }

  const owner = str(event.repository?.owner?.login);
  const repo = str(event.repository?.name);
  const installationId = num(event.installation?.id);
  const pullNumber = num(event.pull_request?.number);
  const headSha = str(event.pull_request?.head?.sha);

  if (
    !owner ||
    !repo ||
    !installationId ||
    !pullNumber ||
    !headSha ||
    !headRef
  ) {
    return { act: false, reason: 'payload is missing fields this needs' };
  }

  return {
    act: true,
    owner,
    repo,
    installationId,
    pullNumber,
    headSha,
    headRef,
  };
}

/**
 * Which changed files are worth scanning for translation keys.
 *
 * Source files only, and never a locale catalogue: a catalogue is what the scan
 * compares *against*, and reading it as source would report its own keys as
 * used and hide the ones that are genuinely missing.
 */
export function analysableFiles(paths: readonly string[]): string[] {
  return paths.filter(
    (path) =>
      /\.(tsx?|jsx?|mjs|cjs)$/i.test(path) &&
      !/(^|\/)(node_modules|dist|build|coverage|\.next)(\/|$)/.test(path),
  );
}
