/**
 * What one guardrail correction actually costs, measured.
 *
 * ## Why the existing benchmark does not answer this
 *
 * `eval/run.ts` measures the **legacy pipeline**: strings extracted from
 * source, each carrying a file path, a component name and surrounding code.
 * `docs/product/09-unit-economics.md` is built on it, and its $1.55 per 1,000
 * pairs is a fair number for that path.
 *
 * The guardrail correction sends something else entirely. A catalogue entry is
 * a key and a string — no file, no component, no surrounding code, because
 * there genuinely is none — so the prompt is a fraction of the size and the
 * per-string cost is a different number. Pricing the product on the benchmark
 * would price a path the product no longer leads with.
 *
 * ## Why three sizes and not one
 *
 * A correction's cost is not proportional to its strings. The system prompt
 * and the instructions are paid once per call whatever the batch holds, and
 * the guardrail's typical correction is **one key**, where that fixed part
 * dominates completely. Measuring only a full batch would quote an average
 * nobody is ever charged. Three points give `cost = fixed + per_string * n`,
 * which is the shape a subscription has to cover.
 *
 * Run from the repository root with ANTHROPIC_API_KEY set:
 *   npx tsx apps/api/eval/correction-cost.ts
 */
import { createAnthropicProvider } from '../src/router/anthropic.js';
import { handleTranslateBatch } from '../src/translate/handler.js';

/** Anthropic list prices for claude-sonnet-5, per million tokens. */
const RATE = { input: 3.0, output: 15.0 };
const MODEL_ID = process.env.API_ANTHROPIC_MODEL ?? 'claude-sonnet-5';

/**
 * The fixture's own English catalogue, flattened the way `packages/core`
 * flattens it. Real content rather than invented strings: a placeholder and a
 * plural are in here, and both change what the model emits.
 */
const CATALOGUE: [string, string][] = [
  ['app.title', 'Acme Dashboard'],
  ['app.tagline', 'Everything your team ships, in one place.'],
  ['nav.home', 'Home'],
  ['nav.projects', 'Projects'],
  ['nav.settings', 'Settings'],
  ['auth.signIn', 'Sign in'],
  ['auth.signOut', 'Sign out'],
  ['auth.greeting', 'Welcome back, {{name}}!'],
  ['projects.count_one', '{{count}} project'],
  ['projects.count_other', '{{count}} projects'],
  ['projects.empty', 'No projects yet.'],
  ['errors.notFound', "We couldn't find that page."],
  ['errors.network', 'Network unavailable. Please try again.'],
  ['errors.timeout', 'The request took too long. Please try again.'],
];

/** Exactly what `translateBatch` in `apps/web` sends: no context fields. */
function correctionStrings(n: number) {
  return CATALOGUE.slice(0, n).map(([key, text]) => ({
    key,
    text,
    filePath: '',
    componentName: null,
    surroundingCode: '',
  }));
}

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set');
  const provider = createAnthropicProvider(apiKey);

  const rows: Record<string, unknown>[] = [];
  for (const n of [1, 4, 14]) {
    const started = Date.now();
    const result = await handleTranslateBatch(
      { targetLocale: 'de', strings: correctionStrings(n) },
      provider,
      MODEL_ID,
    );
    const u = result.usage;
    const cost =
      (u.inputTokens / 1_000_000) * RATE.input +
      (u.outputTokens / 1_000_000) * RATE.output;
    rows.push({
      strings: n,
      requests: u.requests,
      inputTokens: u.inputTokens,
      outputTokens: u.outputTokens,
      thinkingTokens: u.thinkingTokens,
      translated: result.translations.length,
      missing: result.missingKeys.length,
      ms: Date.now() - started,
      costUsd: Number(cost.toFixed(6)),
      costPerString: Number((cost / n).toFixed(6)),
    });
    console.log(JSON.stringify(rows[rows.length - 1]));
  }

  console.log(JSON.stringify({ modelId: MODEL_ID, rate: RATE, rows }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
