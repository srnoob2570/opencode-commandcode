// The catalog is the plugin's whole input: every model Command Code serves,
// with the metadata models.dev does not have yet. A snapshot generated from
// the live registry + models.dev + Command Code's own models reference ships
// with the plugin; the live registry decides which models exist on each boot.
import { SNAPSHOT } from "./snapshot.ts";

export const PROVIDER_ID = "commandcode";
export const LIVE_URL = "https://api.commandcode.ai/provider/v1/models";

/** OpenAI-compatible route (/chat/completions) for open models. */
export const OPENAI_PACKAGE = "@opencode/ai/providers/openai-compatible";
/** Anthropic route (/messages) — Command Code serves Claude models only there. */
export const ANTHROPIC_PACKAGE = "@opencode/ai/providers/anthropic";

/** One context-priced tier, matching the opencode model cost entry. */
export interface CostTier {
  input: number;
  output: number;
  cachedInput?: number;
  cacheWrite?: number;
  tier: { type: "context"; size: number };
}

/** Rate in USD per 1M tokens. Tiers are the prices above their size. */
export interface PricingRate {
  input: number;
  output: number;
  cachedInput?: number;
  cacheWrite?: number;
  tiers?: CostTier[];
}

/** Normalized catalog model — the plugin's internal view. */
export interface CatalogModel {
  id: string;
  name: string;
  /** Runtime package that owns this model's endpoint. */
  package: string;
  capabilities: { tools: boolean; thinking: boolean; vision: boolean };
  context: number;
  maxOutput: number;
  reasoningOptions: string[];
  releaseDate?: string;
  cost?: PricingRate;
}

export interface PluginOpts {
  modelsUrl?: string;
  timeoutMs?: number;
}

/** The live registry entry the plugin consumes. */
export interface LiveModel {
  id: string;
  name: string;
  context_length: number;
  supported_endpoints: string[];
}

/** Conservative limits for an id the snapshot has never seen: it serves, but
 * without inventing capabilities or prices for it. */
const UNKNOWN_OUTPUT = 32768;

export function packageFor(endpoints: string[]): string {
  // A model that answers on /messages and not on /chat/completions is an
  // Anthropic-route model; everything else rides the OpenAI-compatible package.
  return endpoints.includes("/messages") &&
    !endpoints.includes("/chat/completions")
    ? ANTHROPIC_PACKAGE
    : OPENAI_PACKAGE;
}

/** Envelope-tolerant reader: one broken entry never hides the good ones, and
 * a missing/renamed envelope reads as "no live data" (snapshot fallback). */
export function parseLive(value: unknown): LiveModel[] | null {
  if (typeof value !== "object" || value === null) return null;
  const data = (value as { data?: unknown }).data;
  if (!Array.isArray(data)) return null;
  const models: LiveModel[] = [];
  for (const raw of data) {
    if (typeof raw !== "object" || raw === null) continue;
    const entry = raw as Record<string, unknown>;
    const id = entry.id;
    const name = entry.name;
    const context = entry.context_length;
    if (typeof id !== "string" || id.length === 0) continue;
    if (typeof context !== "number" || !Number.isFinite(context) || context < 1)
      continue;
    const endpoints = Array.isArray(entry.supported_endpoints)
      ? entry.supported_endpoints.filter(
          (e): e is string => typeof e === "string",
        )
      : [];
    models.push({
      id,
      name: typeof name === "string" && name.length > 0 ? name : id,
      context_length: context,
      supported_endpoints: endpoints,
    });
  }
  return models.length > 0 ? models : null;
}

/** Union rule: when the live registry answers, it defines the set; the
 * snapshot only enriches it. When it does not, the snapshot serves as-is.
 * This keeps delisted models out and new models visible on day one. */
export function mergeModels(live: LiveModel[] | null): CatalogModel[] {
  if (!live) return SNAPSHOT;
  const known = new Map(SNAPSHOT.map((m) => [m.id, m]));
  return live.map((l) => {
    const base = known.get(l.id);
    const maxOutput = Math.min(
      base?.maxOutput ?? UNKNOWN_OUTPUT,
      l.context_length,
    );
    return {
      id: l.id,
      name: l.name,
      package: packageFor(l.supported_endpoints),
      capabilities:
        base?.capabilities ?? { tools: true, thinking: false, vision: false },
      context: l.context_length,
      maxOutput,
      reasoningOptions: base?.reasoningOptions ?? [],
      ...(base?.releaseDate ? { releaseDate: base.releaseDate } : {}),
      ...(base?.cost ? { cost: base.cost } : {}),
    };
  });
}

async function fetchLive(
  url: string,
  timeoutMs: number,
): Promise<LiveModel[] | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { accept: "application/json" },
    });
    if (!res.ok) return null;
    return parseLive(await res.json());
  } catch {
    return null;
  }
}

export async function loadCatalog(
  opts: PluginOpts = {},
): Promise<CatalogModel[]> {
  const live = await fetchLive(
    opts.modelsUrl ?? LIVE_URL,
    opts.timeoutMs ?? 5000,
  );
  return mergeModels(live);
}
