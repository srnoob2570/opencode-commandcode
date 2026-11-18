import { afterEach, describe, expect, test } from "bun:test";
import plugin, { applyModels, type ProviderDraft } from "./index.ts";
import type { ModelRecord } from "./models.ts";

const record: ModelRecord = {
  id: "m",
  modelID: "m",
  providerID: "commandcode",
  name: "M",
  package: "@opencode/ai/providers/openai-compatible",
  settings: { provider: "commandcode" },
  capabilities: { tools: true, input: ["text"], output: ["text"] },
  cost: [{ input: 0, output: 0, cache: { read: 0, write: 0 } }],
  status: "active",
  enabled: true,
  limit: { context: 1000, output: 1000 },
};

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("entrada del plugin", () => {
  test("es la forma v2 {id, setup}", () => {
    expect(plugin.id).toBe("opencode-commandcode");
    expect(typeof plugin.setup).toBe("function");
    expect("server" in plugin).toBe(false);
  });

  test("setup sin contexto no lanza", async () => {
    await expect(plugin.setup(undefined)).resolves.toBeUndefined();
    await expect(plugin.setup({})).resolves.toBeUndefined();
  });
});

describe("applyModels", () => {
  test("no inyecta si el draft no expone get", () => {
    expect(() => applyModels(undefined, [record])).not.toThrow();
    expect(() => applyModels({}, [record])).not.toThrow();
  });

  test("no inyecta si el provider no existe", () => {
    let called = false;
    applyModels(
      {
        get: () => null,
        models: { set: () => (called = true) },
      },
      [record],
    );
    expect(called).toBe(false);
  });

  test("inyecta el set cuando el provider existe", () => {
    const sets: Array<[string, ModelRecord[]]> = [];
    applyModels(
      {
        get: () => ({ provider: {} }),
        models: { set: (id, models) => sets.push([id, models]) },
      },
      [record],
    );
    expect(sets).toEqual([["commandcode", [record]]]);
  });

  test("un set que lanza no rompe el arranque", () => {
    expect(() =>
      applyModels(
        {
          get: () => ({ provider: {} }),
          models: {
            set: () => {
              throw new Error("boom");
            },
          },
        },
        [record],
      ),
    ).not.toThrow();
  });
});

describe("setup", () => {
  test("registra el transform solo tras cargar el catálogo", async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          data: [
            {
              id: "org/modelo",
              name: "Modelo",
              context_length: 64000,
              supported_endpoints: ["/chat/completions"],
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      )) as unknown as typeof fetch;

    let transform: ((draft: ProviderDraft) => unknown) | undefined;
    await plugin.setup({
      options: { modelsUrl: "https://example.test/models", timeoutMs: 100 },
      provider: {
        transform: (cb: (draft: ProviderDraft) => unknown) => {
          transform = cb;
        },
      },
    });

    expect(typeof transform).toBe("function");
    const sets: Array<[string, ModelRecord[]]> = [];
    transform!({
      get: () => ({ provider: {} }),
      models: { set: (id, models) => sets.push([id, models]) },
    });
    expect(sets).toHaveLength(1);
    expect(sets[0][0]).toBe("commandcode");
    expect(sets[0][1].map((m) => m.id)).toEqual(["org/modelo"]);
  });

  test("si el fetch falla, el snapshot mantiene el catálogo", async () => {
    globalThis.fetch = (async () => {
      throw new Error("sin red");
    }) as unknown as typeof fetch;

    let count = 0;
    await plugin.setup({
      options: { modelsUrl: "https://example.test/models", timeoutMs: 100 },
      provider: {
        transform: (cb: (draft: ProviderDraft) => unknown) => {
          cb({
            get: () => ({ provider: {} }),
            models: {
              set: (_id: string, models: ModelRecord[]) =>
                (count = models.length),
            },
          });
        },
      },
    });
    expect(count).toBe(104);
  });
});
