import 'server-only';
import type { CorrectionFile, ModelUsage } from '@/lib/i18n/correct-run';

/**
 * The two outside edges of the correction: the translation API, and the pull
 * request API.
 *
 * Kept apart from `correct-run.ts` so the decision path — what to translate,
 * what to accept, what to write — has no network in it and is tested without
 * one. This file is the part that cannot be unit-tested honestly, so it is as
 * thin as it can be.
 *
 * ## Both go through `apps/api`, not through Octokit here
 *
 * `run-actions.ts` already opens every pull request this product makes through
 * `/v1/open-pr`, and that route is where the "nothing to commit" check lives —
 * it compares the tree it built against the base and answers 409 rather than
 * opening an empty pull request, the defect that produced five of them on the
 * fixture in two days. Reaching for Octokit here would mean a second way to
 * open a pull request, with its own copy of that comparison or without one.
 *
 * It also avoids adding `@localize-infra/github-app` to this app's
 * dependencies, which would change the lockfile — and this repository's
 * lockfile has to be regenerated under Linux, a five-day CI outage ago.
 */

/**
 * Calls `/v1/translate` the way `run-actions.ts` already does.
 *
 * ## It returns everything the route said, and that is a fix
 *
 * This used to return `translations` alone and drop `missingKeys` and
 * `failures` on the floor. The first production cycle paid that bill: six
 * languages were charged, five were delivered, and German disappeared from the
 * corrective pull request with nothing anywhere saying why — not in the body,
 * not in the webhook's reply, not in a log. The response had carried the
 * answer and two layers had thrown it away.
 *
 * `question` comes back too. A model that says "I am not sure, and here is why"
 * is doing exactly what invariant 4 asks of it; forwarding the sentence is what
 * turns that into something a reviewer can act on instead of an absence.
 */
/**
 * The tally the route reported, or null.
 *
 * Null rather than zero whenever the shape is not what is expected. An older
 * deployment of `apps/api` answers without this field at all, and reading that
 * as "no tokens" would quietly report a real cost as free — which is worse
 * than reporting nothing, because nothing is visibly missing.
 */
function readUsage(value: unknown): ModelUsage | null {
  if (!value || typeof value !== 'object') return null;
  const u = value as Record<string, unknown>;
  const n = (k: string) => (typeof u[k] === 'number' ? (u[k] as number) : null);
  const requests = n('requests');
  if (requests === null) return null;
  return {
    requests,
    inputTokens: n('inputTokens') ?? 0,
    outputTokens: n('outputTokens') ?? 0,
    thinkingTokens: n('thinkingTokens') ?? 0,
  };
}

/** The same, out of an error body that has already been read as text. */
function usageIn(text: string): ModelUsage | null {
  try {
    return readUsage((JSON.parse(text) as { usage?: unknown }).usage);
  } catch {
    return null;
  }
}

export function translateBatch(config: { apiUrl: string; apiToken: string }) {
  return async (args: {
    targetLocale: string;
    strings: { key: string; text: string }[];
  }) => {
    const response = await fetch(`${config.apiUrl}/v1/translate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiToken}`,
      },
      body: JSON.stringify({
        targetLocale: args.targetLocale,
        /*
         * The contract wants context fields, and this path genuinely has
         * none: a catalogue entry is a key and a string, with no file, no
         * component and no surrounding code. They are sent empty rather than
         * filled with something plausible — a fabricated `componentName`
         * would be a guess reaching a model prompt, and the model would
         * weigh it.
         */
        strings: args.strings.map((s) => ({
          key: s.key,
          text: s.text,
          filePath: '',
          componentName: null,
          surroundingCode: '',
        })),
      }),
    });

    if (!response.ok) {
      // Verbatim, truncated (DESIGN.md §8). The API already strips provider
      // errors before returning, so what arrives here is safe to repeat.
      const raw = await response.text();
      const detail = raw.slice(0, 300);
      throw Object.assign(
        new Error(`${response.status} ${response.statusText}: ${detail}`),
        /*
         * The cost rides on the error. A 502 means every chunk failed after up
         * to three paid attempts each; the route reports what that came to and
         * dropping it here would make the most expensive outcome the one
         * recorded as free. Parsed from the whole body rather than the
         * truncated message: the tally sits at the end of the JSON, and 300
         * characters would cut it off.
         */
        { usage: usageIn(raw) },
      );
    }

    const body = (await response.json()) as {
      translations?: {
        key: string;
        text: string;
        confidence?: string;
        question?: string | null;
      }[];
      missingKeys?: string[];
      failures?: { keys?: string[]; attempts?: number; error?: string }[];
      usage?: unknown;
    };

    return {
      translations: (body.translations ?? []).map((t) => ({
        key: t.key,
        text: t.text,
        confidence: t.confidence ?? 'confident',
        question: t.question ?? null,
      })),
      /*
       * `missingKeys` is the route saying "I answered, and this key is not in
       * the answer". Distinct from a key absent for no stated reason, which the
       * caller reports as a defect in this tool rather than a decision.
       */
      missingKeys: body.missingKeys ?? [],
      failures: (body.failures ?? []).map((f) => ({
        keys: f.keys ?? [],
        attempts: f.attempts ?? 1,
        // Verbatim, truncated (DESIGN.md §8). The API strips provider errors
        // before returning, so what arrives here is safe to repeat.
        error: (f.error ?? 'no error given').slice(0, 300),
      })),
      usage: readUsage(body.usage),
    };
  };
}

export type OpenCorrectionResult =
  | { opened: true; prUrl: string; prNumber: number }
  | { opened: false; reason: string };

/**
 * Open the corrective pull request through `/v1/open-pr`.
 *
 * The branch is named by that route — `localize-infra/add-translations-<ms>`
 * — and the prefix is what makes this safe to run on every delivery:
 * `decideWebhook` ignores any pull request whose head ref starts with
 * `localize-infra/`, so the correction cannot trigger an analysis of itself.
 * The App also authors it, and the `Bot` check catches it a second way.
 *
 * 409 is a result, not a failure: the route answers it when the tree it built
 * matches the base, which is this path's idempotence. A redelivery of the same
 * webhook recomputes the same translations and opens nothing the second time.
 */
export async function openCorrectivePr(args: {
  apiUrl: string;
  apiToken: string;
  owner: string;
  repo: string;
  /** The pull request's own head branch — the correction merges back into it. */
  baseBranch: string;
  installationId: number;
  title: string;
  body: string;
  files: CorrectionFile[];
}): Promise<OpenCorrectionResult> {
  const response = await fetch(`${args.apiUrl}/v1/open-pr`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${args.apiToken}`,
    },
    body: JSON.stringify({
      owner: args.owner,
      repo: args.repo,
      baseBranch: args.baseBranch,
      installationId: args.installationId,
      title: args.title,
      body: args.body,
      files: args.files,
    }),
  });

  if (response.status === 409) {
    return {
      opened: false,
      reason: 'every translation is already on the branch',
    };
  }
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    throw new Error(`${response.status} ${response.statusText}: ${detail}`);
  }

  const body = (await response.json()) as {
    prUrl?: string;
    prNumber?: number;
  };
  if (!body.prUrl || typeof body.prNumber !== 'number') {
    return { opened: false, reason: 'the API returned no pull request' };
  }
  return { opened: true, prUrl: body.prUrl, prNumber: body.prNumber };
}
