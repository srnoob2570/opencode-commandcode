import { describe, expect, test } from "bun:test";
import {
  ANTHROPIC_PACKAGE,
  mergeModels,
  OPENAI_PACKAGE,
  packageFor,
  parseLive,
  type LiveModel,
} from "./catalog.ts";

const live = (
  id: string,
  context = 200000,
  endpoints = ["/chat/completions"],
): LiveModel => ({
  id,
  name: `Nombre ${id}`,
  context_length: context,
  supported_endpoints: endpoints,
});

describe("packageFor", () => {
  test("Claude-only /messages va por anthropic", () => {
    expect(packageFor(["/messages"])).toBe(ANTHROPIC_PACKAGE);
  });

  test("un modelo con /chat/completions va por openai-compatible", () => {
    expect(packageFor(["/chat/completions", "/responses"])).toBe(
      OPENAI_PACKAGE,
    );
    expect(packageFor(["/messages", "/chat/completions"])).toBe(
      OPENAI_PACKAGE,
    );
  });

  test("sin endpoints cae en openai-compatible", () => {
    expect(packageFor([])).toBe(OPENAI_PACKAGE);
  });
});

describe("parseLive", () => {
  test("un envelope desconocido se lee como sin datos", () => {
    expect(parseLive(null)).toBeNull();
    expect(parseLive({})).toBeNull();
    expect(parseLive({ data: "nope" })).toBeNull();
    expect(parseLive({ data: [] })).toBeNull();
  });

  test("una entrada rota no oculta las buenas", () => {
    const parsed = parseLive({
      data: [
        { id: "a", name: "A", context_length: 1000, supported_endpoints: [] },
        { id: "", context_length: 10 },
        { id: "sin-contexto" },
        { id: "b", context_length: 0 },
        null,
        {
          id: "c",
          context_length: 2000,
          supported_endpoints: ["/messages", 7, null],
        },
      ],
    });
    expect(parsed?.map((m) => m.id)).toEqual(["a", "c"]);
    expect(parsed?.[0].name).toBe("A");
    expect(parsed?.[1].name).toBe("c");
    expect(parsed?.[1].supported_endpoints).toEqual(["/messages"]);
  });
});

describe("mergeModels", () => {
  test("sin registro live sirve el snapshot completo", () => {
    const models = mergeModels(null);
    expect(models.length).toBe(104);
    expect(models.filter((m) => m.package === ANTHROPIC_PACKAGE)).toHaveLength(
      12,
    );
  });

  test("el registro live define el set y el snapshot solo enriquece", () => {
    const models = mergeModels([live("deepseek/deepseek-v4.1-flash-ultrafast")]);
    expect(models).toHaveLength(1);
    const [ultrafast] = models;
    expect(ultrafast.context).toBe(200000); // live manda sobre el snapshot
    expect(ultrafast.maxOutput).toBe(200000); // capado al contexto live
    expect(ultrafast.cost?.input).toBe(2.4); // metadatos del snapshot
    expect(ultrafast.reasoningOptions).toContain("low");
  });

  test("un id desconocido entra con defaults conservadores", () => {
    const [unknown] = mergeModels([live("org/nuevo", 64000)]);
    expect(unknown.name).toBe("Nombre org/nuevo");
    expect(unknown.capabilities).toEqual({
      tools: true,
      thinking: false,
      vision: false,
    });
    expect(unknown.maxOutput).toBe(32768);
    expect(unknown.cost).toBeUndefined();
    expect(unknown.reasoningOptions).toEqual([]);
  });

  test("un modelo delisted desaparece del set", () => {
    const models = mergeModels([live("claude-fable-5-2")]);
    expect(models.map((m) => m.id)).toEqual(["claude-fable-5-2"]);
  });

  test("el output nunca supera el contexto live", () => {
    const [small] = mergeModels([live("gpt-6.2-astra", 1000)]);
    expect(small.maxOutput).toBe(1000);
  });
});
