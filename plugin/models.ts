import { PROVIDER_ID, type CatalogModel } from "./catalog.ts";

// Models without a published rate share this zero-cost shape (USD per 1M
// tokens). Factory, not constant: a shared mutable object would alias every
// model's cost.
export const zeroCost = () => ({
  input: 0,
  output: 0,
  cache: { read: 0, write: 0 },
});

/** Every model exposes the same four levels, regardless of what the upstream
 * reference lists for it. */
export const EFFORTS = ["off", "low", "high", "max"] as const;

/** A model record accepted by the opencode 2.x catalog (draft.models.set).
 * The authoritative contract is the host's runtime schema: cost is an ARRAY
 * of tiers, release date is epoch MS under `time.released`, and effort
 * variants are an array. */
export interface ModelRecord {
  id: string;
  modelID: string;
  providerID: string;
  name: string;
  package: string;
  settings: Record<string, unknown>;
  capabilities: {
    tools: boolean;
    input: string[];
    output: string[];
  };
  cost: Array<{
    input: number;
    output: number;
    cache: { read: number; write: number };
    tier?: { type: "context"; size: number };
  }>;
  status: string;
  enabled: boolean;
  limit: { context: number; output: number };
  // required: the host encodes the model response with this key present
  time: { released: number };
  variants: Array<{ id: string; settings: Record<string, unknown> }>;
}

function costEntries(m: CatalogModel): ModelRecord["cost"] {
  const cost = m.cost;
  if (!cost) return [{ ...zeroCost() }];
  const entries: ModelRecord["cost"] = [
    {
      input: cost.input,
      output: cost.output,
      cache: { read: cost.cachedInput ?? 0, write: cost.cacheWrite ?? 0 },
    },
  ];
  for (const t of cost.tiers ?? []) {
    entries.push({
      input: t.input,
      output: t.output,
      cache: { read: t.cachedInput ?? 0, write: t.cacheWrite ?? 0 },
      tier: { ...t.tier },
    });
  }
  return entries;
}

export function toModelRecord(m: CatalogModel): ModelRecord {
  const released = m.releaseDate ? Date.parse(m.releaseDate) : Number.NaN;
  const record: ModelRecord = {
    id: m.id,
    modelID: m.id,
    providerID: PROVIDER_ID,
    name: m.name,
    // Claude models answer on /messages only; the catalog already assigned
    // them the Anthropic runtime package. Command Code itself is the provider.
    package: m.package,
    settings: { provider: PROVIDER_ID },
    capabilities: {
      tools: m.capabilities.tools,
      input: m.capabilities.vision ? ["text", "image"] : ["text"],
      output: ["text"],
    },
    cost: costEntries(m),
    status: "active",
    enabled: true,
    limit: { context: m.context, output: m.maxOutput },
    // an unknown date is 0, never NaN: the host sorts by this field without
    // checking that the block exists
    time: { released: Number.isFinite(released) ? released : 0 },
    // effort variants: [{id, settings:{reasoningEffort}}] — Command Code accepts
    // its documented effort strings verbatim (including off/xhigh). Always the
    // same four levels, and always an array: the host requires the key.
    variants: EFFORTS.map((effort) => ({
      id: effort,
      settings: { reasoningEffort: effort },
    })),
  };
  return record;
}
