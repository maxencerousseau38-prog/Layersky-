import { createAnthropicProvider } from './anthropic.js';
import { createOpenAiProvider } from './openai.js';
import type { Provider, TranslateRequest, TranslateResult } from './types.js';

export type {
  Provider,
  TokenUsage,
  TranslateRequest,
  TranslateResult,
} from './types.js';

export type ProviderName = 'anthropic' | 'openai';

/**
 * Canonical order, so provider selection is reproducible.
 *
 * `Object.keys` follows insertion order, which would make the same locale route
 * to a different provider depending on how a caller happened to build its map.
 * Routing has to be a function of the seed alone.
 */
export const PROVIDER_NAMES: readonly ProviderName[] = ['anthropic', 'openai'];

/** Which providers this process actually holds a key for. */
export function configuredProviderNames(
  env: Record<string, string | undefined> = process.env,
): ProviderName[] {
  return PROVIDER_NAMES.filter((name) =>
    name === 'anthropic'
      ? Boolean(env.ANTHROPIC_API_KEY)
      : Boolean(env.OPENAI_API_KEY),
  );
}

/**
 * Spreads locales across the providers that are available.
 *
 * `available` exists because the previous signature assumed both providers
 * always were. In production only Anthropic is configured, and the hash sent
 * roughly half of all locales to OpenAI, where the request died — so a
 * deployment with a perfectly good key translated about half its batches and
 * failed the rest, for a reason that had nothing to do with the text.
 *
 * With one provider configured every seed lands on it. With two, the split is
 * the same as it always was.
 */
export function pickProvider(
  seed: string,
  available: readonly ProviderName[] = PROVIDER_NAMES,
): ProviderName {
  if (available.length === 0) {
    throw new Error('No translation provider is configured');
  }
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return available[hash % available.length] as ProviderName;
}

export function getProvider(name: ProviderName): Provider {
  if (name === 'anthropic') {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set');
    return createAnthropicProvider(apiKey);
  }
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set');
  return createOpenAiProvider(apiKey, process.env.OPENAI_BASE_URL);
}

/** Builds only the providers this process is configured for. */
export function getConfiguredProviders(): Partial<
  Record<ProviderName, Provider>
> {
  const providers: Partial<Record<ProviderName, Provider>> = {};
  for (const name of configuredProviderNames()) {
    providers[name] = getProvider(name);
  }
  return providers;
}

export async function translate(
  req: TranslateRequest,
  provider: Provider,
  modelId: string,
): Promise<TranslateResult> {
  return provider.translate(req, modelId);
}
