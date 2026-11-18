import { describe, expect, test } from "bun:test";
import { PROVIDER_ID, type CatalogModel } from "./catalog.ts";
import { toModelRecord, zeroCost } from "./models.ts";

const base: CatalogModel = {
  id: "deepseek/deepseek-v4.1-flash-ultrafast",
  name: "DeepSeek V4.1 Flash Ultrafast",
  package: "@opencode/ai/providers/openai-compatible",
  capabilities: { tools: true, thinking: true, vision: true },
  context: 1048576,
  maxOutput: 384000,
  reasoningOptions: ["off", "low", "high", "max"],
  releaseDate: "2026-09-01T00:00:00.000Z",
  cost: {
    input: 2.4,
    output: 9.6,
    cachedInput: 0.048,
    tiers: [
      {
        input: 4.8,
        output: 19.2,
        cachedInput: 0.096,
        tier: { type: "context", size: 200000 },
      },
    ],
  },
};

describe("toModelRecord", () => {
  test("mapea identidad, provider y límites", () => {
    const r = toModelRecord(base);
    expect(r.id).toBe(base.id);
    expect(r.modelID).toBe(base.id);
    expect(r.providerID).toBe(PROVIDER_ID);
    expect(r.settings).toEqual({ provider: PROVIDER_ID });
    expect(r.package).toBe(base.package);
    expect(r.limit).toEqual({ context: 1048576, output: 384000 });
    expect(r.status).toBe("active");
    expect(r.enabled).toBe(true);
  });

  test("la visión añade image a la entrada", () => {
    expect(toModelRecord(base).capabilities.input).toEqual(["text", "image"]);
    const textOnly = toModelRecord({
      ...base,
      capabilities: { ...base.capabilities, vision: false },
    });
    expect(textOnly.capabilities.input).toEqual(["text"]);
  });

  test("el coste base y los tiers se mapean a cache.read/write", () => {
    expect(toModelRecord(base).cost).toEqual([
      { input: 2.4, output: 9.6, cache: { read: 0.048, write: 0 } },
      {
        input: 4.8,
        output: 19.2,
        cache: { read: 0.096, write: 0 },
        tier: { type: "context", size: 200000 },
      },
    ]);
  });

  test("sin coste publicado el registro cuesta cero", () => {
    const { cost, ...free } = base;
    expect(toModelRecord(free).cost).toEqual([zeroCost()]);
  });

  test("cada modelo recibe su propio objeto de coste cero", () => {
    expect(zeroCost()).not.toBe(zeroCost());
  });

  test("los esfuerzos se vuelven variantes reasoningEffort", () => {
    expect(toModelRecord(base).variants).toEqual([
      { id: "off", settings: { reasoningEffort: "off" } },
      { id: "low", settings: { reasoningEffort: "low" } },
      { id: "high", settings: { reasoningEffort: "high" } },
      { id: "max", settings: { reasoningEffort: "max" } },
    ]);
  });

  test("sin esfuerzos no hay variantes", () => {
    expect(
      toModelRecord({ ...base, reasoningOptions: [] }).variants,
    ).toBeUndefined();
  });

  test("la fecha va en milisegundos", () => {
    expect(toModelRecord(base).time).toEqual({
      released: Date.parse(base.releaseDate!),
    });
  });

  test("una fecha inválida omite el bloque time", () => {
    expect(
      toModelRecord({ ...base, releaseDate: "no-es-fecha" }).time,
    ).toBeUndefined();
    expect(toModelRecord({ ...base, releaseDate: undefined }).time).toBeUndefined();
  });
});
