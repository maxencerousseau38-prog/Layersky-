'use server';

import { existsSync, statSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import {
  findOrganization,
  findProject,
  mayUsePrivateRepositories,
  requireSession,
} from '@/lib/data/workspace';
import { materialiseRepository } from '@/lib/github/materialise';
import {
  canReachRepository,
  installationIdFor,
} from '@/lib/github/repositories';
import { QuotaRefusal, chargeWorkspace } from '@/lib/quota/charge';
import {
  describeRunShortfall,
  readTranslationBudget,
} from '@/lib/quota/preflight';
import { isNextControlFlowError } from '@/lib/runs/control-flow';
import {
  checkTranslations,
  describeFindings,
  qualityBlock,
} from '@/lib/runs/quality';
import {
  clearResumeCache,
  readResumeCache,
  saveResumeCache,
  splitPending,
} from '@/lib/runs/resume';
import { createClient } from '@/lib/supabase/server';
import {
  buildKeyCatalog,
  buildOpenPrRequest,
  catalogsEqual,
  detectFramework,
  extractFromProject,
  mergeLocaleFile,
  mergeTranslations,
  pendingKeys,
  readLocaleFile,
  repoRelativePath,
} from '@localize-infra/core';
import { TranslateBatchResponseSchema } from '@localize-infra/schemas';
import { revalidatePath } from 'next/cache';

export interface RunState {
  error?: string;
  runId?: string;
}

// 'escalate' is a real stopping point, not a step passed through: a run that
// raised a question ends here and waits for a person. The database enum has
// always carried it; the pipeline never used it, because until now there was
// nothing that could be raised.
type Stage = 'detect' | 'extract' | 'translate' | 'escalate' | 'pull_request';

/**
 * One run: detect, extract, translate, open a pull request.
 *
 * The same sequence the CLI performs, against a repository fetched from GitHub
 * instead of a local clone, and calling the same API the CLI calls rather than
 * re-implementing translation — one prompt, in one place.
 *
 * **It runs inside the request, and that is a limitation rather than a
 * design.** A repository with hundreds of strings across several locales will
 * outlive a serverless timeout and there is no worker to resume it. What the
 * request does guarantee is that a run is never silently lost: the row is
 * written before any work starts and closed in a finally block, so a crash
 * leaves a failed run carrying its reason instead of a row stuck at "running".
 *
 * This said "operator-gated for the same reason connecting a repository is —
 * one shared installation reaches every repository it was ever granted", which
 * the body of the function has contradicted since the gate was removed.
 *
 * Reading the repository and writing the pull request now act as the same
 * installation — the workspace's own. They did not: `/v1/open-pr` took no
 * installation id, so every tenant's pull request came out of whichever one the
 * API had in its environment, and a workspace the operator's installation did
 * not cover would translate and then fail at the last step. The id is resolved
 * once here, by `installationIdFor`, and used for both halves.
 */
export async function startRun(
  orgSlug: string,
  projectSlug: string,
  _prev: RunState,
  _formData: FormData,
): Promise<RunState> {
  await requireSession();
  /*
   * Ungated for the same reason as connecting: a run acts as the workspace's
   * own installation, so it can only reach repositories that installation was
   * granted. The allow-list was standing in for that guarantee while the
   * installation was shared.
   */

  /*
   * Everything from here to `start_run` runs inside a try, and it did not.
   *
   * `start_run` writes the run row before any work, so a throw *before* it
   * leaves no row — and, being uncaught, no message either. The server action
   * rejects, the client state never updates, and the button reads as dead: the
   * user clicks and the page does not move. That is not a hypothetical. It
   * happened twice in production, on 2026-08-31, and cost two reverts and four
   * deploys to characterise, because the one thing the product could have said
   * — the exception — was the one thing it threw away.
   *
   * `canReachRepository` is the reason this stretch can throw at all: it calls
   * GitHub through Octokit, so a rate limit, an expired installation token or
   * any transport fault surfaces here as an exception rather than a value.
   *
   * The catch reports and does not swallow: a Next control-flow throw is
   * re-raised untouched, because `requireSession()` redirects by throwing and
   * catching that would replace a navigation to /login with silence — the same
   * dead button, one layer up.
   */
  let organization: NonNullable<Awaited<ReturnType<typeof findOrganization>>>;
  let project: NonNullable<Awaited<ReturnType<typeof findProject>>>;

  try {
    const foundOrganization = await findOrganization(orgSlug);
    if (!foundOrganization) {
      return { error: 'That workspace is not available.' };
    }
    organization = foundOrganization;

    const foundProject = await findProject(organization.id, projectSlug);
    if (!foundProject) return { error: 'That project is not available.' };
    project = foundProject;
    if (!project.repository_owner || !project.repository_name) {
      return { error: 'Connect a repository before running.' };
    }

    /*
     * Checked again here, not only at connect time.
     *
     * An entitlement can lapse after a repository was connected — a subscription
     * ends, a grant is withdrawn — and a check that only ran once would leave the
     * capability permanently attached to whoever had it first. Public
     * repositories are unaffected: /pricing promises those are free and
     * unlimited, so there is nothing to check for them.
     */
    const repository = await canReachRepository({
      owner: project.repository_owner,
      name: project.repository_name,
      organizationId: organization.id,
    });
    if (
      repository?.private &&
      !(await mayUsePrivateRepositories(organization.id))
    ) {
      // Not a plan. See `connect-actions.ts`: the entitlement follows the
      // GitHub installation, so the remedy is connecting one.
      return {
        error:
          'This project points at a private repository, and this workspace has no GitHub App installation connected. Connect GitHub and run it again.',
      };
    }

    /*
     * Refused before a run row exists, because the alternative is what shipped.
     *
     * With no target locales the loop below iterates zero times, so
     * `localesSucceeded` and `localesFailed` both stay at 0, `failure` stays
     * null, and the guard after the loop throws "Every target locale failed.
     * Last error: unknown" — a sentence about failures where nothing was
     * attempted and no model was called. The first real run against a fixture
     * repository died exactly this way, in 1.4 seconds, and the message sent the
     * search towards the provider and ANTHROPIC_API_KEY.
     *
     * It is checked here rather than made a better message down there: a run
     * that cannot do anything should not get a row, a checkout, or a place in
     * the history somebody reads.
     */
    if (project.target_locales.length === 0) {
      return {
        error:
          'This project has no target languages, so a run would have nothing to translate. Add at least one under Languages.',
      };
    }
  } catch (error) {
    // Re-raised untouched: this is Next navigating, not a fault. See
    // `isNextControlFlowError` for why the digest value is matched and not its
    // presence.
    if (isNextControlFlowError(error)) throw error;

    /*
     * Verbatim (DESIGN.md §8), like every other failure this pipeline reports:
     * a developer comparing this against their own logs must see the same
     * string. No run row exists to carry it, so the returned state is the only
     * place it can be said.
     */
    return {
      error: `Could not start a run: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }

  const supabase = await createClient();
  const { data: run, error: startError } = await supabase.rpc('start_run', {
    p_project_id: project.id,
  });
  if (startError || !run) {
    return {
      error: `Could not start a run: ${startError?.message ?? 'unknown'}`,
    };
  }

  let workdir: string | null = null;
  let stage: Stage = 'detect';
  let framework: string | null = null;
  let keysExtracted = 0;
  let keysTranslated = 0;
  /*
   * Strings the model was asked for and did not return.
   *
   * The API has always reported these — `handleTranslateBatch` computes them
   * and the CLI prints them — and this function read `body.translations` and
   * nothing else. A locale that came back with three strings out of eight
   * hundred was counted a success and the run finished `succeeded`.
   */
  let keysMissing = 0;
  let localesSucceeded = 0;
  let localesFailed = 0;
  const proposals: {
    locale: string;
    translation_key: string;
    source_text: string;
    proposed_text: string;
    origin: 'model' | 'preserved' | 'resolved';
  }[] = [];
  const escalations: {
    key: string;
    locale: string;
    sourceText: string;
    proposedText: string;
    question: string;
    alternatives: { text: string; rationale: string }[];
  }[] = [];
  let prUrl: string | null = null;
  let prNumber: number | null = null;
  const branch: string | null = null;
  let failure: string | null = null;

  const apiUrl = process.env.LOCALIZE_API_URL ?? 'http://127.0.0.1:8787';
  const apiToken = process.env.LOCALIZE_API_TOKEN ?? '';

  try {
    const materialised = await materialiseRepository(
      project.repository_owner,
      project.repository_name,
      project.repository_branch ?? 'main',
      organization.id,
    );
    workdir = materialised.dir;

    if (materialised.truncated) {
      throw new Error(
        'GitHub truncated the repository tree, so extraction would have run against an incomplete checkout. Refusing rather than reporting a partial key count as complete.',
      );
    }

    /*
     * Reading and writing are two different roots, and conflating them is the
     * one mistake this feature can make that produces a plausible-looking pull
     * request.
     *
     *   read  — `<workdir>/<rootDir>/<localesDir>`, inside a temporary checkout
     *   write — `<rootDir>/<localesDir>`, inside the customer's repository
     *
     * Committing the first would open a pull request adding a tree named after
     * a temp directory, next to the real one, which is exactly the failure the
     * `locales_dir` stamp was introduced to stop at the approval path.
     * `repoRelativePath` is the only thing allowed to build a committed path.
     */
    const rootDir = project.root_dir;
    const projectDir = rootDir ? join(workdir, rootDir) : workdir;

    if (!existsSync(projectDir) || !statSync(projectDir).isDirectory()) {
      throw new Error(
        `This project is set to the subdirectory ${rootDir}, which does not exist on branch ${project.repository_branch ?? 'main'}. Check the path, or clear it to run against the repository root.`,
      );
    }

    const detected = detectFramework(projectDir);
    if (!detected) {
      throw new Error(
        rootDir
          ? `No supported framework detected in ${rootDir}. Supported: Next.js, Vite + React, React Native.`
          : 'No supported framework detected. Supported: Next.js, Vite + React, React Native. If this is a monorepo, set the subdirectory the app lives in.',
      );
    }
    framework = detected.name;
    // Built once, used for every committed path and for the stamp the approval
    // path reads back. One expression, so the two cannot disagree.
    const committedLocalesDir = repoRelativePath(rootDir, detected.localesDir);

    /*
     * Progress is written down, not accumulated in memory.
     *
     * `stage` was a local variable persisted once, by finish_run, at the end.
     * For the whole of a run — a checkout, an AST walk, one model call per
     * locale — the row said 'detect', so every reader was told the same thing
     * whether it was translating, waiting, or dead. Each call is awaited: a
     * fire-and-forget write is exactly the one that gets cancelled when the
     * request ends, which is when the record matters most.
     */
    const advance = async (
      to: typeof stage,
      counts: {
        keysExtracted?: number;
        keysTranslated?: number;
        localesSucceeded?: number;
        localesFailed?: number;
      } = {},
    ) => {
      stage = to;
      await supabase.rpc('advance_run', {
        p_run_id: run.id,
        p_stage: to,
        p_framework: framework,
        p_keys_extracted: counts.keysExtracted ?? null,
        p_keys_translated: counts.keysTranslated ?? null,
        p_locales_succeeded: counts.localesSucceeded ?? null,
        p_locales_failed: counts.localesFailed ?? null,
      });
    };

    await advance('extract');
    const extracted = extractFromProject(projectDir, detected.sourceGlobs);
    const fresh = buildKeyCatalog(extracted);
    keysExtracted = Object.keys(fresh).length;

    if (keysExtracted === 0) {
      throw new Error(
        'No translatable strings found, so no pull request was opened.',
      );
    }

    const localesDir = join(projectDir, detected.localesDir);
    const sourceLocale = project.source_locale;
    /*
     * Read before merging, because the merge is what we are comparing against.
     * `mergeLocaleFile` reads this file internally but does not hand it back,
     * so the "before" has to be taken separately.
     */
    const existingSource = readLocaleFile(localesDir, sourceLocale);
    const mergedSource = mergeLocaleFile(localesDir, sourceLocale, fresh);

    /*
     * Whether this run has anything to commit.
     *
     * Compared against `fresh`, the catalogue just extracted from source, not
     * `mergedSource`. `mergeLocaleFile` (packages/core) hardcodes
     * `locale === 'en'` to decide which side wins a conflict, so for any
     * project whose `source_locale` is not literally `'en'` — `fr`, `de`,
     * `en-US`, all real and only shape-validated — the merge keeps the stale
     * `existingSource` value even when the source string genuinely changed.
     * `mergedSource` would then equal `existingSource` by construction and
     * this run would report `no_changes` on a source edit it never saw.
     * `fresh` is the authoritative source catalogue regardless of locale
     * string, so it is what an actual change must be detected against.
     * `existing` is read from a checkout of the base branch, so comparing
     * against it is comparing against exactly what a pull request would be
     * opened on top of. Nothing here costs a network call: both sides are
     * already in memory.
     */
    let anyChanged = !catalogsEqual(fresh, existingSource);

    await advance('translate', { keysExtracted });
    if (!apiToken) {
      throw new Error(
        'LOCALIZE_API_TOKEN is not set, so the translation API cannot be called.',
      );
    }

    const files: { path: string; content: string }[] = [
      {
        path: `${committedLocalesDir}/${sourceLocale}.json`,
        content: `${JSON.stringify(mergedSource, null, 2)}\n`,
      },
    ];

    const strings = extracted.map((entry) => ({
      key: entry.key,
      text: entry.text,
      filePath: entry.filePath,
      componentName: entry.componentName,
      surroundingCode: entry.surroundingCode,
    }));

    /*
     * Does this run fit in today's budget? Asked once, before any locale is
     * charged.
     *
     * The loop below charges per locale and re-raises a refusal rather than
     * isolating it, which is right — a workspace out of budget is out of budget
     * for every remaining language. But it meant a run too large for the
     * ceiling paid for the locales it could afford and then threw, and a run
     * that throws opens no pull request: the customer was charged for six
     * languages and received none of them.
     *
     * The count is deliberately a second pass over the same files rather than a
     * hoist of the loop's own read. `readLocaleFile` throws on malformed JSON,
     * and inside the loop that is one locale failing while the others carry on
     * — the per-language isolation the status board claims. Hoisting it would
     * quietly turn that into a whole run aborting. Reading each file twice is
     * local I/O against a model call; the isolation is worth more.
     */
    /*
     * What a previous run already bought. Read before the count, because a key
     * already paid for is neither sent to the model nor charged again — so it
     * must not appear in the planned total either, or a resumed run would be
     * refused for a budget it is not about to spend.
     */
    const resumeCache = await readResumeCache(
      supabase,
      project.id,
      project.target_locales,
      fresh,
    );

    let plannedUnits = 0;
    for (const locale of project.target_locales) {
      try {
        const stillPending = pendingKeys(
          fresh,
          readLocaleFile(localesDir, locale),
        );
        const cached = resumeCache.get(locale);
        plannedUnits += cached
          ? stillPending.filter((key) => !cached.has(key)).length
          : stillPending.length;
      } catch {
        // Its worst case, not zero. A file this pass cannot read is one the
        // loop cannot read either, so it will send every fresh key or fail
        // outright — and a preflight must never under-count what a run will
        // spend. The real error is reported below, where isolation applies.
        plannedUnits += Object.keys(fresh).length;
      }
    }

    const shortfall = describeRunShortfall(
      plannedUnits,
      await readTranslationBudget(organization.id),
    );
    // Thrown as a refusal so the outer catch ends the run with this sentence,
    // exactly as a mid-run refusal does. The difference the customer sees is
    // that nothing was spent to learn it.
    if (shortfall) throw new QuotaRefusal(shortfall, 'quota');

    for (const locale of project.target_locales) {
      try {
        const existing = readLocaleFile(localesDir, locale);

        // Only keys with no translation yet are sent. Two reasons, and both
        // matter to someone paying for this: a key that already has a value
        // carries somebody's decision, and re-translating every string on
        // every run bills a model for work finished months ago.
        const pending = new Set(pendingKeys(fresh, existing));
        const pendingStrings = strings.filter((entry) =>
          pending.has(entry.key),
        );

        /*
         * Resumption, at the only point where it saves anything.
         *
         * `fromCache` is model output a previous run paid for and never
         * delivered, still matching the source text extracted a moment ago.
         * `toTranslate` is what is genuinely left. The quota below is charged
         * for the second only — charging for a key this run does not send would
         * bill the customer twice for one translation.
         */
        const { toTranslate, fromCache } = splitPending(
          pendingStrings,
          resumeCache.get(locale),
        );

        // Seeded, not assigned later: the merge below must see the recovered
        // keys as well, or a resumed run would commit a file missing precisely
        // the translations it resumed in order to keep.
        let translated: Record<string, string> = { ...fromCache };
        keysTranslated += Object.keys(fromCache).length;

        if (toTranslate.length > 0) {
          /*
           * Charged before the model is called, for the strings this request
           * carries — the same route, the same units and the same counters the
           * API charges a CLI token. After would be too late: the money is
           * spent by then and a refusal protects nothing.
           *
           * A refusal throws `QuotaRefusal`, which the catch below re-raises
           * rather than recording as one locale's failure.
           */
          await chargeWorkspace({
            organizationId: organization.id,
            route: 'translate',
            units: toTranslate.length,
          });

          const response = await fetch(`${apiUrl}/v1/translate`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${apiToken}`,
            },
            body: JSON.stringify({
              targetLocale: locale,
              strings: toTranslate,
            }),
          });

          if (!response.ok) {
            // Verbatim (DESIGN.md §8): a customer comparing this against their
            // own logs must see the same string.
            const detail = (await response.text()).slice(0, 300);
            throw new Error(
              `${response.status} ${response.statusText}: ${detail}`,
            );
          }

          // Parsed through the shared schema rather than cast, so a contract
          // drift surfaces here instead of as a confusing merge downstream.
          const body = TranslateBatchResponseSchema.parse(
            await response.json(),
          );
          translated = {
            ...translated,
            ...Object.fromEntries(
              body.translations.map((entry) => [entry.key, entry.text]),
            ),
          };
          keysTranslated += body.translations.length;

          /*
           * Banked here, immediately, and not at the end of the run.
           *
           * This single line is what makes a run resumable. Everything below —
           * the remaining locales, the merge, the quality gate, the pull
           * request — can still be cut off by the platform timeout, and until
           * now that cut threw this locale's paid-for output away. From here it
           * survives, and the next click resumes instead of re-buying.
           */
          await saveResumeCache(
            supabase,
            project.id,
            locale,
            body.translations.map((entry) => ({
              translation_key: entry.key,
              source_text: fresh[entry.key] ?? '',
              translated_text: entry.text,
            })),
          );
          keysMissing += body.missingKeys.length;

          /*
           * Why keys are missing, when the API knows.
           *
           * `missingKeys` alone cannot tell a model that answered and left a
           * string out from a chunk whose every attempt came back unparseable,
           * and those deserve different reactions: the first is the model being
           * incomplete, the second is a run that lost work to a fault and has
           * already retried it three times.
           *
           * Recorded verbatim (DESIGN.md §8) and only when there is nothing
           * worse to report — a locale that failed outright sets `failure` in
           * the catch below, and that is the more useful message of the two.
           */
          for (const chunkFailure of body.failures) {
            failure ??= `${locale}: ${chunkFailure.keys.length} string(s) lost after ${chunkFailure.attempts} attempts — ${chunkFailure.error}`;
          }

          // Invariant 4, at the only point where it can actually be enforced.
          // A string the model refused to guess at becomes a question in the
          // queue, and its proposal is still used so the file is complete —
          // the PR is what waits, not the translation.
          for (const entry of body.translations) {
            if (entry.confidence !== 'ambiguous' || !entry.question) continue;
            escalations.push({
              key: entry.key,
              locale,
              sourceText: fresh[entry.key] ?? entry.text,
              proposedText: entry.text,
              question: entry.question,
              alternatives: entry.alternatives,
            });
          }
        }

        // Precedence lives in packages/core, next to its regression tests.
        // This was `{ ...existing, ...translated }`, which let fresh model
        // output overwrite a translation somebody had corrected by hand — the
        // opposite of what this product promises about manual changes.
        const merged = mergeTranslations(fresh, existing, translated);
        if (!catalogsEqual(merged, existing)) anyChanged = true;

        files.push({
          path: `${committedLocalesDir}/${locale}.json`,
          content: `${JSON.stringify(merged, null, 2)}\n`,
        });
        // Written down so the review screen shows what will actually be
        // committed. If approval re-ran the model, the diff a developer
        // approved and the diff that landed would be two different samples
        // from the same distribution.
        for (const [key, value] of Object.entries(merged)) {
          proposals.push({
            locale,
            translation_key: key,
            source_text: fresh[key] ?? '',
            proposed_text: value,
            origin: existing[key] !== undefined ? 'preserved' : 'model',
          });
        }

        localesSucceeded += 1;
      } catch (error) {
        /*
         * A usage refusal is not a locale failing, and must not be isolated
         * like one. It applies to the whole workspace, so every remaining
         * locale would be refused too — turning one honest refusal into four
         * identical ones and reporting the run as `partial`. Re-raised to the
         * outer catch, which ends the run with this sentence.
         */
        if (error instanceof QuotaRefusal) throw error;
        // One locale failing must not abort the rest: that is the
        // per-language failure isolation the status board already claims.
        localesFailed += 1;
        failure = error instanceof Error ? error.message : String(error);
      }
    }

    if (localesSucceeded === 0) {
      // Now true when it fires: the empty-list case is refused above, so
      // reaching here means locales were attempted and all of them failed.
      throw new Error(
        `All ${localesFailed} target locale(s) failed. Last error: ${failure ?? 'unknown'}`,
      );
    }

    /*
     * Nothing to commit, so nothing is committed.
     *
     * This used to fall straight through to /v1/open-pr, which created a
     * branch, blobs whose SHAs already existed, a tree identical to the base
     * tree and therefore an empty commit — a pull request with zero changed
     * files. It produced five of them on the fixture repository in two days,
     * #10 through #14, all since closed.
     *
     * That count used to read "two of them are still open", naming #1 and #2.
     * Both are real translations — es.json in one, en.json and fr.json in the
     * other — and the claim was copied from CLAUDE.md into four places without
     * anyone opening them.
     *
     * Placed after the all-failed guard and gated on `localesFailed === 0`: a
     * run where a locale threw has not established that there was nothing to
     * do, only that it did not get far enough to find out. Escalations cannot
     * exist here — they come from model responses, and a run with nothing
     * pending made no model call — but it is checked rather than assumed,
     * because that reasoning is about today's control flow and this branch
     * must not silently swallow a question.
     *
     * Before `record_run_translations`, so a repeated click does not add
     * another dozen `preserved` proposals nobody asked for. The trade is that
     * the review screen shows nothing for such a run, which is correct: there
     * is nothing to review.
     *
     * The quality gate is skipped for the same reason — it exists to stop this
     * run from committing something wrong, and this run commits nothing.
     * Re-checking content already on the branch would report a failure the run
     * did not cause.
     */
    if (!anyChanged && localesFailed === 0 && escalations.length === 0) {
      // Checked, unlike every other write in this block: this is the one path
      // whose only observable effect *is* this write. Every other branch that
      // reaches here has already committed or already thrown, so a write
      // failure has something else to fall back on. This one does not — if
      // `finish_run` fails silently, the row stays at running/translate
      // forever, the user is told nothing, and it reads as stalled five
      // minutes later. Throwing routes the failure through the catch/finally
      // below, which is what closes the run as `failed` with a real message.
      const { error: finishError } = await supabase.rpc('finish_run', {
        p_run_id: run.id,
        p_status: 'no_changes',
        p_stage: 'translate',
        p_framework: framework,
        p_keys_extracted: keysExtracted,
        p_keys_translated: keysTranslated,
        p_locales_succeeded: localesSucceeded,
        p_locales_failed: localesFailed,
        p_error: null,
        p_pr_url: null,
        p_pr_number: null,
        p_branch: null,
      });
      if (finishError) {
        throw new Error(
          `Could not record this run as finished: ${finishError.message}`,
        );
      }
      revalidatePath(`/${organization.slug}/projects/${project.slug}`);
      return { runId: run.id };
    }

    // Everything proposed is written down before anything is decided, so the
    // review screen and the pull request are the same object seen twice.
    if (proposals.length > 0) {
      await supabase.rpc('record_run_translations', {
        p_run_id: run.id,
        p_rows: proposals,
        // Stamped here because this is the only moment the path is known: it
        // comes from framework detection against a checkout this request is
        // holding open, and approval happens later with no checkout in reach.
        p_locales_dir: committedLocalesDir,
      });
    }

    /*
     * The quality gate, before every other decision about this run.
     *
     * `packages/eval` has carried deterministic placeholder and ICU checks
     * since Sprint 0, gated in CI at 99.5% — and nothing on this path ran
     * them. A run could commit a translation whose `%{count}` had become
     * `%{compte}` and open the pull request with a clean description.
     *
     * First, and not after the ambiguity gate, because these two failures are
     * different in kind. An escalation says a human must choose between two
     * defensible readings; a broken placeholder says the file is wrong. Sending
     * a wrong file to `awaiting_review` would invite somebody to approve it.
     */
    const byLocale = new Map<string, Record<string, string>>();
    for (const proposal of proposals) {
      const entries = byLocale.get(proposal.locale) ?? {};
      entries[proposal.translation_key] = proposal.proposed_text;
      byLocale.set(proposal.locale, entries);
    }
    const quality = checkTranslations(
      fresh,
      [...byLocale].map(([locale, entries]) => ({ locale, entries })),
    );

    if (!quality.passed) {
      await supabase.rpc('finish_run', {
        p_run_id: run.id,
        p_status: 'failed',
        p_stage: 'translate',
        p_framework: framework,
        p_keys_extracted: keysExtracted,
        p_keys_translated: keysTranslated,
        p_locales_succeeded: localesSucceeded,
        p_locales_failed: localesFailed,
        // Verbatim, like every other failure this pipeline reports: a developer
        // comparing this against their own files must see the same strings.
        p_error: `${quality.findings.length} of ${quality.checked} translation(s) failed a quality check, so no pull request was opened.
${describeFindings(quality)}`,
      });
      revalidatePath(`/${organization.slug}/projects/${project.slug}`);
      return {
        error: `Quality checks failed on ${quality.findings.length} translation(s). No pull request was opened.`,
      };
    }

    // The gate. Invariant 4 says the agent raises ambiguities rather than
    // guessing them, and a pipeline that raised them and opened the pull
    // request anyway would be guessing with extra steps.
    if (escalations.length > 0) {
      // Reported, not just assigned: a run that stops to ask a question is one
      // a reader is most likely to be watching, so `escalate` has to reach the
      // row rather than living in a local variable until finish_run.
      await advance('escalate', {
        keysTranslated,
        localesSucceeded,
        localesFailed,
      });

      for (const escalation of escalations) {
        await supabase.rpc('record_ambiguity', {
          p_run_id: run.id,
          p_translation_key: escalation.key,
          p_locale: escalation.locale,
          p_source_text: escalation.sourceText,
          p_proposed_text: escalation.proposedText,
          p_question: escalation.question,
          p_alternatives: escalation.alternatives,
        });
      }

      await supabase.rpc('finish_run', {
        p_run_id: run.id,
        p_status: 'awaiting_review',
        p_stage: 'escalate',
        p_framework: framework,
        p_keys_extracted: keysExtracted,
        p_keys_translated: keysTranslated,
        p_locales_succeeded: localesSucceeded,
        p_locales_failed: localesFailed,
        p_error: null,
        p_pr_url: null,
        p_pr_number: null,
        p_branch: null,
      });

      revalidatePath(`/${organization.slug}/projects/${project.slug}`);
      return { runId: run.id };
    }

    await advance('pull_request', {
      keysTranslated,
      localesSucceeded,
      localesFailed,
    });

    /*
     * The same installation the tree was read through.
     *
     * `materialiseRepository` has already resolved and used it above, so this
     * cannot be null here in practice — it is re-resolved rather than threaded
     * through because the alternative is a parameter that exists only to be
     * carried, and re-reading is the cheaper of the two to keep correct. The
     * refusal below is what makes the type non-optional at the call site rather
     * than an assumption about the code above.
     */
    const installationId = await installationIdFor(organization.id);
    if (!installationId) {
      throw new Error(
        'This workspace has no GitHub installation, so no pull request can be opened.',
      );
    }

    // One unit: a pull request is one act, whatever it contains. Same route
    // and same daily ceiling the API charges a CLI token for.
    await chargeWorkspace({
      organizationId: organization.id,
      route: 'open_pr',
      units: 1,
    });

    const prResponse = await fetch(`${apiUrl}/v1/open-pr`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiToken}`,
      },
      // Same builder as the approval path in ambiguity-actions.ts, so the two
      // cannot drift on what the envelope must contain. They have twice.
      body: JSON.stringify(
        buildOpenPrRequest(
          {
            owner: project.repository_owner,
            repo: project.repository_name,
            baseBranch: project.repository_branch ?? 'main',
            installationId,
          },
          {
            title: `Add translations (${project.target_locales.join(', ')})`,
            // The shortfall is named in the pull request itself, because that
            // is where the reviewer is. A body reporting only what worked
            // leaves them to notice the gap by diffing key counts by hand.
            body: `Extracted ${keysExtracted} strings from ${framework}, translated ${keysTranslated} into ${localesSucceeded} locale(s).${
              keysMissing > 0
                ? `\n\nNote: ${keysMissing} string(s) were not translated and are absent from these files. Re-run to attempt them again.`
                : ''
            }\n\n${qualityBlock(quality)}`,
          },
          files,
        ),
      ),
    });

    if (!prResponse.ok) {
      const detail = (await prResponse.text()).slice(0, 300);
      throw new Error(
        `${prResponse.status} ${prResponse.statusText}: ${detail}`,
      );
    }

    const pr = (await prResponse.json()) as { prUrl: string; prNumber: number };
    prUrl = pr.prUrl;
    prNumber = pr.prNumber;

    /*
     * Delivered, so no longer worth keeping.
     *
     * The cache exists to hold model output that was paid for and never
     * reached the customer. A pull request is the moment it reaches them: from
     * here the branch carries those keys, `pendingKeys` will never ask about
     * them again, and the rows are dead weight that only grows.
     *
     * Placed after the pull request rather than after the merge, because the
     * product never learns that a pull request merged. If it is closed unmerged
     * the next run re-translates — the same outcome as before this cache
     * existed, at the cost of one run, and the alternative is rows nothing ever
     * removes.
     */
    await clearResumeCache(supabase, project.id, project.target_locales);
    // Deliberately not set. The API generates a timestamped branch name and
    // its response carries only the URL and number, so anything written here
    // would be a guess — and the first version guessed
    // "localize-infra/add-translations" while the real branch was
    // "localize-infra/add-translations-1786961416681". Recording the pull
    // request and leaving the branch null is the honest pair; surfacing the
    // branch needs the API to return it.
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
  } finally {
    if (workdir) {
      await rm(workdir, { recursive: true, force: true }).catch(() => {});
    }
  }

  /*
   * Closed exactly once, whatever happened.
   *
   * `partial` is a real outcome and not a rounding of success: a pull request
   * exists but at least one locale did not make it into it. Reporting that as
   * succeeded is precisely the lie this structure exists to prevent.
   */
  const status = prUrl
    ? // `keysMissing` belongs in this condition and was absent from it. The
      // file is still written with what did arrive — a partial translation
      // merged over the existing one is better than nothing, and
      // `mergeTranslations` protects anything edited by hand. What must not
      // happen is calling it finished.
      localesFailed > 0 || keysMissing > 0
      ? 'partial'
      : 'succeeded'
    : 'failed';

  await supabase.rpc('finish_run', {
    p_run_id: run.id,
    p_status: status,
    p_stage: stage,
    p_framework: framework,
    p_keys_extracted: keysExtracted,
    p_keys_translated: keysTranslated,
    p_locales_succeeded: localesSucceeded,
    p_locales_failed: localesFailed,
    p_error: failure,
    p_pr_url: prUrl,
    p_pr_number: prNumber,
    p_branch: branch,
  });

  revalidatePath(`/${orgSlug}/projects/${projectSlug}`);
  return status === 'failed'
    ? { error: failure ?? 'The run failed.', runId: run.id }
    : { runId: run.id };
}
