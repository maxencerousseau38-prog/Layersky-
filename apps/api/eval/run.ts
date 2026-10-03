import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CorpusEntry, GlossaryEntry } from '@localize-infra/schemas';
import {
  checkGlossaryConsistency,
  chrf,
  exactMatch,
  isIcuMessage,
  lengthOverflow,
  loadCorpus,
  loadGlossary,
  placeholdersIntact,
} from '../../../packages/eval/src/index.js';
import { createAnthropicProvider } from '../src/router/anthropic.js';
import {
  type UsageTotals,
  handleTranslateBatch,
  usageOfFailedBatch,
} from '../src/translate/handler.js';
import { CONFIGS, type EvalConfig } from './configs.js';

/**
 * Which model and settings should be the default, decided by running them.
 *
 * The three configurations go through the **production** path — the prompt in
 * `src/translate/prompt.ts`, the batching and `missingKeys` accounting in
 * `handleTranslateBatch`, the parser in `parse-response.ts` — against the
 * existing 414-entry corpus in `packages/eval`, scored with that package's
 * existing deterministic checks. Nothing about the benchmark is new except
 * chrF, which is a published metric rather than one invented here.
 *
 * Raw model output is written next to the report so scoring can be reworked
 * without paying for inference again.
 *
 * Run with: npx tsx apps/api/eval/run.ts
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, 'results');

interface Scored {
  id: string;
  locale: string;
  sourceText: string;
  reference: string;
  produced: string | null;
  confidence: 'confident' | 'ambiguous' | null;
  chrf: number | null;
  exact: boolean | null;
  placeholderIntact: boolean | null;
  glossaryViolations: number;
  lengthOverflow: boolean | null;
}

function readApiKey(): string {
  const env = readFileSync(join(HERE, '../../../.env'), 'utf8');
  const key = /^ANTHROPIC_API_KEY\s*=\s*(.+)$/m
    .exec(env)?.[1]
    ?.trim()
    .replace(/^["']|["']$/g, '');
  if (!key) throw new Error('ANTHROPIC_API_KEY not found in .env');
  return key;
}

/** Corpus entries in the shape the production request takes. */
function toStrings(entries: CorpusEntry[]) {
  return entries.map((entry) => ({
    key: entry.id,
    text: entry.sourceText,
    filePath: entry.filePath,
    componentName: entry.componentName,
    surroundingCode: entry.surroundingCode,
  }));
}

async function runConfig(
  config: EvalConfig,
  byLocale: Map<string, CorpusEntry[]>,
  glossary: GlossaryEntry[],
  apiKey: string,
) {
  /*
   * Summed off what `handleTranslateBatch` returns, not off a callback on the
   * provider.
   *
   * The provider used to report usage through an `onUsage` hook wired at
   * construction, which worked here and reached nothing in production: cost
   * has to be attributed to a *request*, and the provider is built once at
   * startup. Reading it from the return value is the same number for this
   * harness and the only shape the webhook can use — so the benchmark now
   * measures the path production measures itself with.
   *
   * It is also strictly more complete: `requests` counts retried attempts,
   * which the hook also saw but `usage.length` then conflated with calls.
   */
  let totals: UsageTotals = {
    requests: 0,
    inputTokens: 0,
    outputTokens: 0,
    thinkingTokens: 0,
  };
  const add = (u: UsageTotals | null) => {
    if (!u) return;
    totals = {
      requests: totals.requests + u.requests,
      inputTokens: totals.inputTokens + u.inputTokens,
      outputTokens: totals.outputTokens + u.outputTokens,
      thinkingTokens: totals.thinkingTokens + u.thinkingTokens,
    };
  };
  const provider = createAnthropicProvider(apiKey, config.settings);

  const scored: Scored[] = [];
  const localeLatency: Record<string, number> = {};
  let requestedTotal = 0;
  let missingTotal = 0;
  const errors: string[] = [];

  for (const [locale, entries] of byLocale) {
    const started = Date.now();
    let translations: { key: string; text: string; confidence: string }[] = [];
    let missingKeys: string[] = [];

    try {
      const result = await handleTranslateBatch(
        { targetLocale: locale, strings: toStrings(entries) },
        provider,
        config.modelId,
      );
      translations = result.translations as typeof translations;
      missingKeys = result.missingKeys;
      add(result.usage);
    } catch (error) {
      // A locale that fails entirely is a real outcome, not a reason to abort
      // the benchmark. Every one of its keys counts as missing — and it still
      // cost whatever its attempts cost, which rides on the error.
      add(usageOfFailedBatch(error));
      missingKeys = entries.map((e) => e.id);
      errors.push(
        `${locale}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    localeLatency[locale] = Date.now() - started;
    requestedTotal += entries.length;
    missingTotal += missingKeys.length;

    const produced = new Map(translations.map((t) => [t.key, t]));

    for (const entry of entries) {
      const got = produced.get(entry.id);
      const text = got?.text ?? null;
      const hasPlaceholders =
        /\{\{?[a-zA-Z0-9_]+\}?\}|%[sd]/.test(entry.sourceText) || false;

      scored.push({
        id: entry.id,
        locale,
        sourceText: entry.sourceText,
        reference: entry.humanReference,
        produced: text,
        confidence:
          (got?.confidence as 'confident' | 'ambiguous' | undefined) ?? null,
        chrf: text === null ? null : chrf(text, entry.humanReference).score,
        exact: text === null ? null : exactMatch(text, entry.humanReference),
        placeholderIntact:
          text === null || !hasPlaceholders
            ? null
            : placeholdersIntact(entry.sourceText, text),
        glossaryViolations:
          text === null
            ? 0
            : checkGlossaryConsistency(
                entry.sourceText,
                text,
                entry.targetLocale,
                glossary,
              ).filter((hit) => !hit.respected).length,
        lengthOverflow:
          text === null ? null : lengthOverflow(text, entry.maxLength),
      });
    }
  }

  const cost =
    (totals.inputTokens / 1_000_000) * config.rate.input +
    (totals.outputTokens / 1_000_000) * config.rate.output;

  return {
    config,
    scored,
    usage: {
      inputTokens: totals.inputTokens,
      outputTokens: totals.outputTokens,
      thinkingTokens: totals.thinkingTokens,
    },
    cost,
    requests: totals.requests,
    requestedTotal,
    missingTotal,
    localeLatency,
    errors,
  };
}

function summarise(run: Awaited<ReturnType<typeof runConfig>>) {
  const answered = run.scored.filter((s) => s.produced !== null);
  const mean = (xs: number[]) =>
    xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length;
  const rate = (n: number, d: number) => (d === 0 ? null : n / d);

  const withPlaceholders = run.scored.filter(
    (s) => s.placeholderIntact !== null,
  );
  const totalLatency = Object.values(run.localeLatency).reduce(
    (a, b) => a + b,
    0,
  );

  const byLocale: Record<string, unknown> = {};
  for (const locale of new Set(run.scored.map((s) => s.locale))) {
    const rows = run.scored.filter((s) => s.locale === locale);
    const got = rows.filter((r) => r.produced !== null);
    byLocale[locale] = {
      requested: rows.length,
      answered: got.length,
      chrf: mean(got.map((r) => r.chrf ?? 0)),
      exactMatchRate: rate(got.filter((r) => r.exact).length, got.length),
      latencyMs: run.localeLatency[locale] ?? null,
    };
  }

  return {
    id: run.config.id,
    label: run.config.label,
    modelId: run.config.modelId,
    settings: run.config.settings,
    note: run.config.note,

    requested: run.requestedTotal,
    answered: answered.length,
    missingKeys: run.missingTotal,
    completionRate: rate(answered.length, run.requestedTotal),
    errors: run.errors,

    // Quality, against the corpus's own human references.
    chrfMean: mean(answered.map((s) => s.chrf ?? 0)),
    exactMatchRate: rate(
      answered.filter((s) => s.exact).length,
      answered.length,
    ),

    // Formatting. Only 19 of 414 corpus entries carry a placeholder, and none
    // carry an ICU message, so these are reported with their denominators
    // rather than as bare percentages.
    placeholderApplicable: withPlaceholders.length,
    placeholderIntactRate: rate(
      withPlaceholders.filter((s) => s.placeholderIntact).length,
      withPlaceholders.length,
    ),

    // Terminology.
    glossaryViolations: run.scored.reduce(
      (a, s) => a + s.glossaryViolations,
      0,
    ),

    lengthOverflowRate: rate(
      answered.filter((s) => s.lengthOverflow).length,
      answered.length,
    ),

    // Invariant 4 in numbers: how often the model asked instead of guessing.
    escalationRate: rate(
      answered.filter((s) => s.confidence === 'ambiguous').length,
      answered.length,
    ),

    requests: run.requests,
    latencyMsTotal: totalLatency,
    latencyMsPerRequest:
      run.requests === 0 ? null : totalLatency / run.requests,
    tokens: run.usage,
    costUsd: run.cost,
    costPerThousandPairs:
      run.requestedTotal === 0 ? null : (run.cost / run.requestedTotal) * 1000,

    byLocale,
  };
}

async function main(): Promise<void> {
  const apiKey = readApiKey();
  const corpus = loadCorpus();
  const glossary = loadGlossary();

  const byLocale = new Map<string, CorpusEntry[]>();
  for (const entry of corpus) {
    const list = byLocale.get(entry.targetLocale) ?? [];
    list.push(entry);
    byLocale.set(entry.targetLocale, list);
  }

  const icuEntries = corpus.filter((e) => isIcuMessage(e.sourceText)).length;

  mkdirSync(OUT_DIR, { recursive: true });
  const summaries = [];
  const raw: Record<string, Scored[]> = {};

  /*
   * `EVAL_CONFIGS` narrows the run to named configurations.
   *
   * The full sweep exists to choose a model; a prompt change needs only the
   * production configuration, re-run to show quality did not regress. Paying
   * for three when one answers the question is how a required check turns into
   * one that gets skipped.
   */
  const requested = process.env.EVAL_CONFIGS?.split(',').map((s) => s.trim());
  const selected = requested
    ? CONFIGS.filter((c) => requested.includes(c.id))
    : CONFIGS;
  if (selected.length === 0) {
    throw new Error(
      `EVAL_CONFIGS matched nothing. Known ids: ${CONFIGS.map((c) => c.id).join(', ')}`,
    );
  }

  for (const config of selected) {
    process.stdout.write(`running ${config.id}…\n`);
    const run = await runConfig(config, byLocale, glossary, apiKey);
    raw[config.id] = run.scored;
    const summary = summarise(run);
    summaries.push(summary);
    process.stdout.write(
      `  answered ${summary.answered}/${summary.requested}, chrF ${summary.chrfMean?.toFixed(1)}, $${summary.costUsd.toFixed(3)}, ${(summary.latencyMsTotal / 1000).toFixed(0)}s\n`,
    );
  }

  const report = {
    ranAt: new Date().toISOString(),
    corpus: {
      entries: corpus.length,
      locales: [...byLocale.keys()],
      perLocale: Object.fromEntries(
        [...byLocale].map(([l, e]) => [l, e.length]),
      ),
      glossaryTerms: glossary.length,
      entriesWithIcu: icuEntries,
      entriesWithPlaceholders: corpus.filter((e) =>
        /\{\{?[a-zA-Z0-9_]+\}?\}|%[sd]/.test(e.sourceText),
      ).length,
    },
    // Stated in the artefact, not only in prose: a reader of this JSON must not
    // have to know which checks had nothing to run against.
    notMeasured: {
      icuValidity:
        icuEntries === 0
          ? 'No corpus entry is an ICU message, so this check has no applicable input.'
          : null,
      pluralCategories:
        icuEntries === 0
          ? 'Depends on ICU messages, of which the corpus has none.'
          : null,
      humanPreference:
        'Never run. See docs/product/08-critique.md §C2. chrF and exact match are reference-agreement proxies, not quality judgements.',
    },
    configs: summaries,
  };

  writeFileSync(
    join(OUT_DIR, 'model-comparison.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  writeFileSync(
    join(OUT_DIR, 'raw-translations.json'),
    `${JSON.stringify(raw, null, 2)}\n`,
  );
  process.stdout.write(`wrote ${OUT_DIR}\n`);
}

await main();
