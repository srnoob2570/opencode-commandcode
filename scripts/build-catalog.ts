// Regenerates plugin/snapshot.ts from three sources:
//   1. the live registry (which models exist, context, endpoints)
//   2. models.dev (output limits, modalities, release dates, prices) — the
//      source opencode already reads, lagging behind on new models
//   3. Command Code's models reference (prices, efforts, names) — covers the
//      ids models.dev has not caught up with
//
// Run with `bun run build:catalog`. The runtime never runs this file.
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const LIVE_URL = "https://api.commandcode.ai/provider/v1/models";
const MODELS_DEV_URL = "https://models.dev/api.json";
const CC_MODELS_URL =
  "https://cdn.jsdelivr.net/npm/command-code@latest/dist/bundled/command-code-knowledge/reference/models.md";

const OPENAI_PACKAGE = "@opencode/ai/providers/openai-compatible";
const ANTHROPIC_PACKAGE = "@opencode/ai/providers/anthropic";
const UNKNOWN_OUTPUT = 32768;

interface LiveModel {
  id: string;
  name: string;
  context_length: number;
  supported_endpoints: string[];
}

interface Rate {
  input: number;
  output: number;
  cachedInput?: number;
  cacheWrite?: number;
  tiers?: Array<{
    input: number;
    output: number;
    cachedInput?: number;
    cacheWrite?: number;
    tier: { type: "context"; size: number };
  }>;
}

interface ReferenceRow {
  name: string;
  context?: number;
  efforts: string[];
  vision: boolean;
  cost?: Rate;
}

interface MdModel {
  id?: string;
  name?: string;
  attachment?: boolean;
  reasoning?: boolean;
  tool_call?: boolean;
  reasoning_options?: Array<{ type?: string; values?: unknown[] }>;
  modalities?: { input?: string[] };
  limit?: { context?: number; output?: number };
  release_date?: string;
  cost?: {
    input?: number;
    output?: number;
    cache_read?: number;
    cache_write?: number;
    tiers?: Array<{
      input?: number;
      output?: number;
      cache_read?: number;
      cache_write?: number;
      tier?: { type?: string; size?: number };
    }>;
  };
}

interface SnapshotEntry {
  id: string;
  name: string;
  package: string;
  capabilities: { tools: boolean; thinking: boolean; vision: boolean };
  context: number;
  maxOutput: number;
  reasoningOptions: string[];
  releaseDate?: string;
  cost?: Rate;
}

const finite = (v: unknown, min = 0): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= min;

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { accept: "text/plain" } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.text();
}

function parseLive(value: unknown): LiveModel[] {
  const data = (value as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) throw new Error("live registry: no data array");
  const models: LiveModel[] = [];
  for (const raw of data) {
    if (typeof raw !== "object" || raw === null) continue;
    const e = raw as Record<string, unknown>;
    if (typeof e.id !== "string" || !e.id) continue;
    if (!finite(e.context_length, 1)) continue;
    models.push({
      id: e.id,
      name: typeof e.name === "string" && e.name ? e.name : e.id,
      context_length: e.context_length,
      supported_endpoints: Array.isArray(e.supported_endpoints)
        ? e.supported_endpoints.filter((v): v is string => typeof v === "string")
        : [],
    });
  }
  if (models.length < 50)
    throw new Error(`live registry: only ${models.length} usable models`);
  return models;
}

function parseContext(value: string): number | undefined {
  const m = /^([\d.]+)([MK])$/.exec(value);
  if (!m) return undefined;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.round(n * (m[2] === "M" ? 1_000_000 : 1_000));
}

function parseRate(value: string): Rate | undefined {
  const m = /\$([\d.]+)\/\$([\d.]+)(?:\s*·\s*cache\s*\$([\d.]+)(?:\s*\(write\s*\$([\d.]+)\))?)?/.exec(
    value,
  );
  if (!m) return undefined;
  const input = Number(m[1]);
  const output = Number(m[2]);
  if (!finite(input) || !finite(output)) return undefined;
  const rate: Rate = { input, output };
  if (m[3] !== undefined) rate.cachedInput = Number(m[3]);
  if (m[4] !== undefined) rate.cacheWrite = Number(m[4]);
  return rate;
}

/** Tables are `| \`id\` | Name | Context | Efforts | Price | Plan | Best for |`. */
export function parseReference(markdown: string): Map<string, ReferenceRow> {
  const rows = new Map<string, ReferenceRow>();
  for (const line of markdown.split("\n")) {
    const m = /^\|\s*`([^`]+)`\s*\|(.*)$/.exec(line);
    if (!m) continue;
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    if (cells.length < 7) continue;
    const [, name, context, efforts, price, , bestFor] = cells;
    const row: ReferenceRow = {
      name,
      efforts:
        efforts === "—" || efforts === "-"
          ? []
          : efforts.split(",").map((e) => e.trim()).filter(Boolean),
      vision: /\b(vision|multimodal|omni|image|vl)\b/i.test(
        `${name} ${bestFor}`,
      ),
    };
    const parsedContext = parseContext(context);
    if (parsedContext) row.context = parsedContext;
    const rate = parseRate(price);
    if (rate) row.cost = rate;
    rows.set(m[1], row);
  }
  return rows;
}

function effortValues(m: MdModel): string[] {
  return (m.reasoning_options ?? [])
    .filter((o) => o.type === "effort" && Array.isArray(o.values))
    .flatMap((o) => o.values ?? [])
    .filter((v): v is string => typeof v === "string");
}

function mapCost(m: MdModel): Rate | undefined {
  const c = m.cost;
  if (!c || !finite(c.input) || !finite(c.output)) return undefined;
  const rate: Rate = { input: c.input, output: c.output };
  if (finite(c.cache_read)) rate.cachedInput = c.cache_read;
  if (finite(c.cache_write)) rate.cacheWrite = c.cache_write;
  const tiers: NonNullable<Rate["tiers"]> = [];
  for (const t of c.tiers ?? []) {
    if (
      t.tier?.type !== "context" ||
      !finite(t.tier.size, 1) ||
      !finite(t.input) ||
      !finite(t.output)
    )
      continue;
    const tier: NonNullable<Rate["tiers"]>[number] = {
      input: t.input,
      output: t.output,
      tier: { type: "context", size: t.tier.size },
    };
    if (finite(t.cache_read)) tier.cachedInput = t.cache_read;
    if (finite(t.cache_write)) tier.cacheWrite = t.cache_write;
    tiers.push(tier);
  }
  if (tiers.length > 0) rate.tiers = tiers;
  return rate;
}

function packageFor(endpoints: string[]): string {
  return endpoints.includes("/messages") &&
    !endpoints.includes("/chat/completions")
    ? ANTHROPIC_PACKAGE
    : OPENAI_PACKAGE;
}

function commonPrefix(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

/** Closest models.dev sibling, never across organizations: `recursive/flint`
 * must not inherit from `reflection/beam` just because both start with "re". */
function siblingOf(id: string, md: Map<string, MdModel>): MdModel | undefined {
  const org = id.includes("/") ? id.slice(0, id.indexOf("/")) : undefined;
  let best: { score: number; model: MdModel } | undefined;
  for (const [key, model] of md) {
    if (key === id) continue;
    if (org !== undefined) {
      if (!key.startsWith(`${org}/`)) continue;
    } else if (key.includes("/")) continue;
    const score = commonPrefix(id, key);
    if (!best || score > best.score) best = { score, model };
  }
  return best?.model;
}

function buildSnapshot(
  live: LiveModel[],
  mdById: Map<string, MdModel>,
  reference: Map<string, ReferenceRow>,
): SnapshotEntry[] {
  const stats = { md: 0, reference: 0, sibling: 0, defaults: 0 };
  const entries = live.map((l): SnapshotEntry => {
    const md = mdById.get(l.id);
    const ref = reference.get(l.id);
    const sib = md ? undefined : siblingOf(l.id, mdById);
    if (md) stats.md++;
    else if (ref) stats.reference++;
    else if (sib) stats.sibling++;
    else stats.defaults++;

    const mdOutput = md?.limit?.output;
    const sibOutput = sib?.limit?.output;
    const output = finite(mdOutput, 1)
      ? mdOutput
      : finite(sibOutput, 1)
        ? sibOutput
        : UNKNOWN_OUTPUT;

    const mdVision =
      md?.attachment === true ||
      (md?.modalities?.input ?? []).includes("image");
    // A sibling is only a proxy: a positive signal from the reference wins
    // over the sibling's "no", never the other way around.
    const vision = md
      ? mdVision
      : sib?.attachment === true || ref?.vision === true;
    const thinking = md
      ? md.reasoning === true
      : sib?.reasoning === true || (ref?.efforts.length ?? 0) > 0;
    const tools = md?.tool_call ?? sib?.tool_call ?? true;

    let efforts = md ? effortValues(md) : (ref?.efforts ?? effortValues(sib ?? {}));
    if (!thinking) efforts = [];

    const cost = md ? mapCost(md) : ref?.cost;

    const entry: SnapshotEntry = {
      id: l.id,
      name: l.name,
      package: packageFor(l.supported_endpoints),
      capabilities: { tools, thinking, vision },
      context: l.context_length,
      maxOutput: Math.min(output, l.context_length),
      reasoningOptions: [...new Set(efforts)],
    };
    if (md?.release_date) entry.releaseDate = md.release_date;
    if (cost) entry.cost = cost;
    return entry;
  });

  const seen = new Set<string>();
  for (const e of entries) {
    if (seen.has(e.id)) throw new Error(`duplicate id in snapshot: ${e.id}`);
    seen.add(e.id);
    if (e.context < 1 || e.maxOutput < 1 || e.maxOutput > e.context)
      throw new Error(`bad limits for ${e.id}`);
    if (e.package !== OPENAI_PACKAGE && e.package !== ANTHROPIC_PACKAGE)
      throw new Error(`bad package for ${e.id}`);
    if (e.id.startsWith("claude-") && e.package !== ANTHROPIC_PACKAGE)
      throw new Error(`claude model without the anthropic package: ${e.id}`);
  }

  console.log(
    `snapshot: ${entries.length} models (models.dev ${stats.md}, reference ${stats.reference}, sibling ${stats.sibling}, defaults ${stats.defaults})`,
  );
  return entries.sort((a, b) => a.id.localeCompare(b.id));
}

const here = dirname(fileURLToPath(import.meta.url));

const [rawLive, rawModelsDev, markdown] = await Promise.all([
  fetchJson(LIVE_URL),
  fetchJson(MODELS_DEV_URL),
  fetchText(CC_MODELS_URL),
]);

const live = parseLive(rawLive);
const provider = (rawModelsDev as { commandcode?: { models?: unknown } })
  .commandcode?.models;
if (typeof provider !== "object" || provider === null)
  throw new Error("models.dev: no commandcode.models");
const mdById = new Map(Object.entries(provider as Record<string, MdModel>));
const reference = parseReference(markdown);

const snapshot = buildSnapshot(live, mdById, reference);
const source = `// Generated by scripts/build-catalog.ts — do not edit by hand.
// Regenerate with \`bun run build:catalog\`.
import type { CatalogModel } from "./catalog.ts";

export const SNAPSHOT: CatalogModel[] = ${JSON.stringify(snapshot, null, 2)};
`;
await writeFile(join(here, "..", "plugin", "snapshot.ts"), source);
console.log("wrote plugin/snapshot.ts");
