import { join } from 'node:path';
import {
  buildKeyCatalog,
  detectFramework,
  extractFromProject,
  mergeLocaleFile,
  readLocaleFile,
  writeLocaleFile,
} from '@localize-infra/core';
import { OpenPrApiRequestSchema } from '@localize-infra/schemas';
import {
  ApiUnreachableError,
  preflightPullRequest,
  whoami,
} from '../api-client.js';
import { resolveApiUrl } from '../config.js';
import { requestPr } from '../open-pr-client.js';
import { translateBatch } from '../translate-client.js';

// Same owner/repo character-set constraints the API enforces server-side
// (OpenPrApiRequestSchema), reused here so an invalid --owner/--repo fails
// fast, client-side, before the per-locale translation loop below runs any
// billed LLM calls — rather than failing with a raw ZodError from
// requestPr() only after that loop (and every locale's translation) has
// already completed.
const OwnerRepoSchema = OpenPrApiRequestSchema.pick({
  owner: true,
  repo: true,
});

const DEFAULT_LOCALES = ['de', 'ja', 'es', 'ar', 'pt-BR'];

export type InitResult =
  | {
      ok: true;
      framework: string;
      keysWritten: number;
      locales: {
        locale: string;
        keysWritten: number;
        missingKeys: string[];
        error: string | null;
      }[];
      pr?: { prUrl: string; prNumber: number };
      /** The workspace a personal token acts for, when the API says so. */
      workspace?: string;
      /**
       * Why no pull request was opened, when one was asked for and the API
       * refused or failed. The translations above are still on disk.
       */
      prError?: string;
    }
  | { ok: false; reason: string };

export async function runInit(
  targetDir: string,
  options?: {
    force?: boolean;
    apiUrl?: string;
    apiToken?: string;
    locales?: string[];
    openPr?: boolean;
    owner?: string;
    repo?: string;
    baseBranch?: string;
  },
): Promise<InitResult> {
  const framework = detectFramework(targetDir);
  if (!framework) {
    return {
      ok: false,
      reason:
        'No supported framework detected. Supported: Next.js, Vite + React, React Native.',
    };
  }

  const extracted = extractFromProject(targetDir, framework.sourceGlobs);
  const fresh = buildKeyCatalog(extracted);
  const localesDir = join(targetDir, framework.localesDir);

  const existing = readLocaleFile(localesDir, 'en');
  const droppedKeys = Object.keys(existing).filter((key) => !(key in fresh));
  if (droppedKeys.length > 0 && !options?.force) {
    return {
      ok: false,
      reason: `Refusing to overwrite locales/en.json: ${droppedKeys.length} existing key(s) would be removed (they no longer match any extracted string). Re-run with --force to proceed anyway.`,
    };
  }

  const apiToken = options?.apiToken;
  if (!apiToken) {
    return {
      ok: false,
      reason:
        'No API token configured. Pass --api-token or set the LOCALIZE_API_TOKEN environment variable.',
    };
  }

  // Fail fast, before any writes and before the (billed) per-locale
  // translation loop runs: --open-pr without a valid --owner/--repo can
  // only ever fail later at the requestPr() call, but by then every locale
  // has already been translated. Catching it here means a typo'd or
  // missing --owner/--repo costs nothing.
  if (options?.openPr) {
    const ownerRepoResult = OwnerRepoSchema.safeParse({
      owner: options.owner ?? '',
      repo: options.repo ?? '',
    });
    if (!ownerRepoResult.success) {
      return {
        ok: false,
        reason:
          '--open-pr requires valid --owner and --repo values (non-empty, matching GitHub repository slug characters: letters, digits, ".", "_", "-"). Pass both flags and re-run.',
      };
    }
  }

  const apiUrl = resolveApiUrl(options?.apiUrl);

  /*
   * Ask before writing or spending anything.
   *
   * A revoked token used to surface once per locale, after locales/en.json had
   * been rewritten; a repository the GitHub installation could not reach
   * surfaced only after every locale had been translated and paid for. Both are
   * now one refusal, up front, with nothing written.
   */
  let workspace: string | undefined;
  try {
    const caller = await whoami(apiUrl, apiToken);
    if (caller.kind === 'workspace') {
      workspace = caller.workspace;
      if (options?.openPr && !caller.githubConnected) {
        return {
          ok: false,
          reason: `Workspace "${caller.workspace}" has no GitHub connection, so --open-pr cannot open a pull request. Connect GitHub in the Layersky web app, or run without --open-pr.`,
        };
      }
    }
    if (options?.openPr) {
      await preflightPullRequest(apiUrl, apiToken, {
        owner: options.owner ?? '',
        repo: options.repo ?? '',
        baseBranch: options.baseBranch ?? 'main',
      });
    }
  } catch (error) {
    if (error instanceof ApiUnreachableError) {
      return {
        ok: false,
        reason: `Could not reach the API at ${apiUrl} (${error.message}). Check your network, or the URL given by --api-url or LOCALIZE_API_URL.`,
      };
    }
    return {
      ok: false,
      reason: `Refused by ${apiUrl}: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const merged = mergeLocaleFile(localesDir, 'en', fresh);
  writeLocaleFile(localesDir, 'en', merged);

  const targetLocales = options?.locales ?? DEFAULT_LOCALES;
  const translatableStrings = extracted.map((e) => ({
    key: e.key,
    text: e.text,
    filePath: e.filePath,
    componentName: e.componentName,
    surroundingCode: e.surroundingCode,
  }));

  const localeResults: {
    locale: string;
    keysWritten: number;
    missingKeys: string[];
    error: string | null;
  }[] = [];
  for (const locale of targetLocales) {
    try {
      const { translations, missingKeys } = await translateBatch(
        apiUrl,
        locale,
        translatableStrings,
        apiToken,
      );
      const freshForLocale = buildKeyCatalog(translations);
      const mergedLocale = mergeLocaleFile(localesDir, locale, freshForLocale);
      writeLocaleFile(localesDir, locale, mergedLocale);
      localeResults.push({
        locale,
        keysWritten: Object.keys(mergedLocale).length,
        missingKeys,
        error: null,
      });
    } catch (error) {
      localeResults.push({
        locale,
        keysWritten: 0,
        missingKeys: [],
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const keysWritten = Object.keys(merged).length;

  if (options?.openPr) {
    // Only include locales that actually succeeded: a locale whose translateBatch call
    // failed was never written to disk, so readLocaleFile would return `{}` for it and
    // silently include an empty locale file in the PR instead of omitting it.
    const prFiles = localeResults
      .filter((r) => r.error === null)
      .map((r) => ({
        path: `${framework.localesDir}/${r.locale}.json`,
        // Read back what was just written, rather than recomputing a merge: mergeLocaleFile's
        // loop only walks the KEYS OF ITS `fresh` ARGUMENT, so calling it with an empty catalog
        // here would silently return `{}`, not the file's real contents. readLocaleFile reads
        // the actual bytes on disk that writeLocaleFile produced a few lines above.
        content: `${JSON.stringify(readLocaleFile(localesDir, r.locale), null, 2)}\n`,
      }));

    // If every target locale's translation failed, there's nothing to put in a PR.
    // OpenPrApiRequestSchema requires a non-empty `files` array, so calling requestPr
    // here would throw a raw ZodError from client-side validation before the request
    // is even sent. Skip the call and return normally instead: the per-locale `error`
    // fields in localeResults already explain what failed and why.
    if (prFiles.length > 0) {
      let prResult: Awaited<ReturnType<typeof requestPr>>;
      try {
        prResult = await requestPr(
          apiUrl,
          {
            owner: options.owner ?? '',
            repo: options.repo ?? '',
            baseBranch: options.baseBranch ?? 'main',
            title: `Add translations (${targetLocales.join(', ')})`,
            body: `Automated by \`localize-infra init\`. ${localeResults.map((r) => `${r.locale}: ${r.keysWritten} key(s)${r.missingKeys.length > 0 ? ` (${r.missingKeys.length} untranslated)` : ''}`).join('; ')}`,
            files: prFiles,
          },
          apiToken,
        );
      } catch (error) {
        /*
         * The translations are done and on disk. Throwing here used to replace
         * the per-locale summary with one line about the pull request, so a
         * person could not tell what had been translated — and paid for.
         */
        return {
          ok: true,
          framework: framework.name,
          keysWritten,
          locales: localeResults,
          ...(workspace ? { workspace } : {}),
          prError: error instanceof Error ? error.message : String(error),
        };
      }
      /*
       * A run that changed nothing returns without a `pr`, and that is not a
       * failure. The API answers 409 when every file in the request already
       * matches the base branch — a repository that is simply up to date —
       * and `requestPr` reports that as an outcome rather than throwing.
       *
       * Before this, the API opened a pull request with zero changed files and
       * the CLI printed its URL as a success. Five of those appeared on the
       * fixture repository in two days.
       */
      return {
        ok: true,
        framework: framework.name,
        keysWritten,
        locales: localeResults,
        ...(workspace ? { workspace } : {}),
        ...(prResult.opened ? { pr: prResult.pr } : {}),
      };
    }
  }

  return {
    ok: true,
    framework: framework.name,
    keysWritten,
    locales: localeResults,
    ...(workspace ? { workspace } : {}),
  };
}
