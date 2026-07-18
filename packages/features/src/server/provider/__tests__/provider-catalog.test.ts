// Catalog-level tests: the offered menu (faux only under the dev flag),
// model resolution against pi-ai's real registry per provider, and the two
// selection transforms — read-boundary normalization (heals, never throws)
// and the Settings patch (loud on bad input, defaults the model on a
// provider switch).

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  applySelectionPatch,
  listProviderModels,
  listSupportedProviders,
  normalizeSelection,
  parseSupportedProvider,
  providerRequiresAuth,
  resolveProviderModel,
} from "../provider-catalog";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("provider menu", () => {
  it("offers OpenAI and Claude (no faux) without the dev flag", () => {
    expect(listSupportedProviders().map((p) => p.id)).toEqual(["openai-codex", "anthropic"]);
  });

  it("adds faux under INTELIGIR_FAUX_AGENT=1", () => {
    vi.stubEnv("INTELIGIR_FAUX_AGENT", "1");
    expect(listSupportedProviders().map((p) => p.id)).toEqual([
      "openai-codex",
      "anthropic",
      "faux",
    ]);
  });

  it("parses only offered providers (faux is unknown without the flag)", () => {
    expect(parseSupportedProvider("anthropic")).toBe("anthropic");
    expect(parseSupportedProvider("faux")).toBeNull();
    expect(parseSupportedProvider("google")).toBeNull();
  });

  it("faux is the only provider that needs no auth", () => {
    vi.stubEnv("INTELIGIR_FAUX_AGENT", "1");
    expect(providerRequiresAuth("openai-codex")).toBe(true);
    expect(providerRequiresAuth("anthropic")).toBe(true);
    expect(providerRequiresAuth("faux")).toBe(false);
  });
});

describe("model resolution", () => {
  it("resolves each provider's default model in pi-ai's registry", () => {
    const openai = resolveProviderModel("openai-codex", "gpt-5.5");
    expect(openai.provider).toBe("openai-codex");
    expect(openai.id).toBe("gpt-5.5");

    const claude = resolveProviderModel("anthropic", "claude-sonnet-4-6");
    expect(claude.provider).toBe("anthropic");
    expect(claude.id).toBe("claude-sonnet-4-6");
  });

  it("resolves faux's model through the live registration, not the registry", () => {
    const model = resolveProviderModel("faux", "faux-1");
    expect(model.provider).toBe("faux");
    expect(model.api).toBe("faux");
  });

  it("throws descriptively for a model the provider doesn't know", () => {
    expect(() => resolveProviderModel("anthropic", "gpt-5.5")).toThrow(/not found/);
  });

  it("lists models per provider (a Claude model never leaks into OpenAI)", () => {
    const claudeIds = listProviderModels("anthropic").map((m) => m.id);
    expect(claudeIds).toContain("claude-sonnet-4-6");
    expect(listProviderModels("openai-codex").map((m) => m.id)).not.toContain("claude-sonnet-4-6");
  });
});

describe("normalizeSelection (read boundary — heals, never throws)", () => {
  it("passes a valid selection through", () => {
    expect(normalizeSelection({ provider: "anthropic", modelId: "claude-opus-4-7" })).toEqual({
      provider: "anthropic",
      modelId: "claude-opus-4-7",
    });
  });

  it("falls back to the default provider+model on an unknown provider", () => {
    expect(normalizeSelection({ provider: "google", modelId: "gemini-2.5-pro" })).toEqual({
      provider: "openai-codex",
      modelId: "gpt-5.5",
    });
  });

  it("falls back to faux→default when the flag is off (stale flagged store)", () => {
    expect(normalizeSelection({ provider: "faux", modelId: "faux-1" })).toEqual({
      provider: "openai-codex",
      modelId: "gpt-5.5",
    });
  });

  it("falls back to the provider's default model on an unknown model", () => {
    expect(normalizeSelection({ provider: "anthropic", modelId: "gpt-5.5" })).toEqual({
      provider: "anthropic",
      modelId: "claude-sonnet-4-6",
    });
  });
});

describe("applySelectionPatch (Settings — loud on bad input)", () => {
  const current = { provider: "openai-codex", modelId: "gpt-5.5" };

  it("switching provider without a model moves to that provider's default", () => {
    expect(applySelectionPatch(current, { provider: "anthropic" })).toEqual({
      provider: "anthropic",
      modelId: "claude-sonnet-4-6",
    });
  });

  it("changing only the model keeps the provider", () => {
    expect(applySelectionPatch(current, { modelId: "gpt-5.4" })).toEqual({
      provider: "openai-codex",
      modelId: "gpt-5.4",
    });
  });

  it("switching provider with an explicit valid model honors it", () => {
    expect(
      applySelectionPatch(current, { provider: "anthropic", modelId: "claude-opus-4-7" }),
    ).toEqual({ provider: "anthropic", modelId: "claude-opus-4-7" });
  });

  it("throws on an unknown provider", () => {
    expect(() => applySelectionPatch(current, { provider: "google" })).toThrow(
      /Unknown AI provider/,
    );
  });

  it("throws on a model the target provider doesn't know", () => {
    expect(() =>
      applySelectionPatch(current, { provider: "anthropic", modelId: "gpt-5.5" }),
    ).toThrow(/not available/);
  });

  it("an empty patch normalizes the current selection", () => {
    expect(applySelectionPatch({ provider: "bogus", modelId: "x" }, {})).toEqual({
      provider: "openai-codex",
      modelId: "gpt-5.5",
    });
  });
});
