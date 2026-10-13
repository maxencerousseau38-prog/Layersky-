import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * What a previous run already bought, so this one does not buy it twice.
 *
 * A run is one serverless request and every chunk of every locale is awaited in
 * turn, so wall-clock is the whole sum and the platform cuts it at its timeout.
 * Before this, the cut discarded everything: `record_run_translations` writes
 * once after the locale loop, and a run that dies opens no pull request, so a
 * customer could be billed for six languages and receive none.
 *
 * `translation_cache` holds model output per (project, locale, key). This
 * module is the two ends of it — read what is already paid for, write each
 * locale the moment it lands.
 *
 * **It is a cache, in the sense invariant 1 means.** Git stays the source of
 * truth. Every way this can go wrong costs a wasted row or a repeated
 * translation; none of them can produce a wrong translation, because a hit
 * requires the source text to match exactly.
 */

/** One locale's usable hits, keyed by translation key. */
export type CachedLocale = Map<string, string>;

/** Every locale's hits. Absent locale means nothing cached. */
export type ResumeCache = Map<string, CachedLocale>;

/** The row shape `translation_cache` returns. */
export interface CacheRow {
  locale: string;
  translation_key: string;
  source_text: string;
  translated_text: string;
}

/**
 * Keep only rows whose source text still matches what was just extracted.
 *
 * This is the whole correctness argument, so it is a pure function with its own
 * tests rather than a `.eq()` buried in a query. A key whose English changed is
 * a different string; reusing the old translation because the key matched would
 * ship something stale and call it a saving.
 *
 * `fresh` is the freshly extracted source catalogue — key to source text.
 */
export function usableCache(
  rows: readonly CacheRow[],
  fresh: Readonly<Record<string, string>>,
): ResumeCache {
  const cache: ResumeCache = new Map();
  for (const row of rows) {
    // A key that is no longer extracted at all is not a hit either: the run
    // will not ask about it, and keeping it would only inflate the count.
    const current = fresh[row.translation_key];
    if (current === undefined || current !== row.source_text) continue;

    let locale = cache.get(row.locale);
    if (!locale) {
      locale = new Map();
      cache.set(row.locale, locale);
    }
    locale.set(row.translation_key, row.translated_text);
  }
  return cache;
}

/**
 * Split what this locale still owes into "already bought" and "must send".
 *
 * Returned as two arrays rather than one filtered list because both are needed
 * downstream and recomputing the complement is how the two drift: the quota is
 * charged for `toTranslate`, and the merge needs `fromCache` as well or the
 * locale file would come out missing everything a previous run paid for.
 */
export function splitPending<T extends { key: string }>(
  pendingStrings: readonly T[],
  cached: CachedLocale | undefined,
): { toTranslate: T[]; fromCache: Record<string, string> } {
  if (!cached || cached.size === 0) {
    return { toTranslate: [...pendingStrings], fromCache: {} };
  }
  const toTranslate: T[] = [];
  const fromCache: Record<string, string> = {};
  for (const entry of pendingStrings) {
    const hit = cached.get(entry.key);
    if (hit === undefined) toTranslate.push(entry);
    else fromCache[entry.key] = hit;
  }
  return { toTranslate, fromCache };
}

/**
 * What one model response may bank for a later run.
 *
 * **Never an ambiguous translation.** The cache keeps no confidence and no
 * question, and escalations are raised only from a fresh model response. A run
 * cut off by the timeout after banking an ambiguous proposal would hand it to
 * the next click as an ordinary hit, and that click would commit it with nobody
 * having answered the question — invariant 4, bypassed by the feature that
 * exists to survive the timeout. Leaving it out means the next run re-buys that
 * key and the model asks again, which is the behaviour before this cache.
 *
 * A key with no extracted source text is left out too: `usableCache` compares
 * against the freshly extracted text, so such a row could never be a hit.
 */
export function cacheableRows(
  translations: readonly {
    key: string;
    text: string;
    confidence: 'confident' | 'ambiguous';
  }[],
  fresh: Readonly<Record<string, string>>,
): { translation_key: string; source_text: string; translated_text: string }[] {
  const rows = [];
  for (const entry of translations) {
    if (entry.confidence !== 'confident') continue;
    const source = fresh[entry.key];
    if (source === undefined) continue;
    rows.push({
      translation_key: entry.key,
      source_text: source,
      translated_text: entry.text,
    });
  }
  return rows;
}

/**
 * Read the cache for one project.
 *
 * Returns an empty cache on any failure, and that is deliberate: a cache that
 * cannot be read is a cache miss. The run then does exactly what it did before
 * this module existed — translates everything and pays for it — which is
 * wasteful and correct. Failing closed here would refuse runs over a table
 * whose entire purpose is to be optional.
 */
export async function readResumeCache(
  supabase: SupabaseClient,
  projectId: string,
  locales: readonly string[],
  fresh: Readonly<Record<string, string>>,
): Promise<ResumeCache> {
  if (locales.length === 0) return new Map();
  try {
    const { data, error } = await supabase
      .from('translation_cache')
      .select('locale,translation_key,source_text,translated_text')
      .eq('project_id', projectId)
      .in('locale', [...locales]);
    if (error || !data) return new Map();
    return usableCache(data as CacheRow[], fresh);
  } catch {
    return new Map();
  }
}

/**
 * Write one locale's model output, immediately after it lands.
 *
 * Inside the locale loop, not after it. That placement is the feature: a run
 * cut off after three of ten locales must leave three locales bought.
 *
 * Swallows its own failure for the same reason the read does — this call is
 * between a paid model response and the rest of the run, and throwing here
 * would lose the very work it exists to preserve. Logged, because unlike the
 * read this one silently costs money on the next run and somebody should be
 * able to find out why.
 */
export async function saveResumeCache(
  supabase: SupabaseClient,
  projectId: string,
  locale: string,
  rows: readonly {
    translation_key: string;
    source_text: string;
    translated_text: string;
  }[],
): Promise<void> {
  if (rows.length === 0) return;
  try {
    const { error } = await supabase.rpc('save_translation_cache', {
      p_project_id: projectId,
      p_locale: locale,
      p_rows: rows,
    });
    if (error) console.error('could not save resume cache:', error.message);
  } catch (err) {
    console.error('could not save resume cache:', err);
  }
}

/**
 * Forget what a pull request has delivered.
 *
 * Called once a run has committed, for the locales it committed. From then on
 * the repository carries those keys and `pendingKeys` never asks again, so the
 * rows are dead weight — and a row nobody reads is a row that will eventually
 * be read by mistake.
 *
 * Also swallowed: a cache that failed to clear is stale rows, and stale rows
 * are already handled by the source-text check on the way in.
 */
export async function clearResumeCache(
  supabase: SupabaseClient,
  projectId: string,
  locales: readonly string[],
): Promise<void> {
  if (locales.length === 0) return;
  try {
    const { error } = await supabase.rpc('clear_translation_cache', {
      p_project_id: projectId,
      p_locales: [...locales],
    });
    if (error) console.error('could not clear resume cache:', error.message);
  } catch (err) {
    console.error('could not clear resume cache:', err);
  }
}
