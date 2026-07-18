// Store-level tests for the provider-config JsonStore: the openai-codex/
// gpt-5.5 default (the pre-swap hardcoded pair — an untouched install must
// not regress), disk round-trips across instances, and the close() kill
// switch logout teardown relies on.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { ProviderConfigStore } from "../provider-config";

let tmp: string;

function storeAt(dir: string): ProviderConfigStore {
  return new ProviderConfigStore({ storePath: path.join(dir, "provider-config.json") });
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "provider-config-"));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("ProviderConfigStore", () => {
  it("defaults to the pre-swap hardcoded pair (openai-codex / gpt-5.5)", () => {
    expect(storeAt(tmp).get()).toEqual({ provider: "openai-codex", modelId: "gpt-5.5" });
  });

  it("round-trips a selection across instances (persists to disk)", () => {
    storeAt(tmp).set({ provider: "anthropic", modelId: "claude-sonnet-4-6" });
    expect(storeAt(tmp).get()).toEqual({ provider: "anthropic", modelId: "claude-sonnet-4-6" });
  });

  it("set returns the persisted selection", () => {
    expect(storeAt(tmp).set({ provider: "anthropic", modelId: "claude-opus-4-7" })).toEqual({
      provider: "anthropic",
      modelId: "claude-opus-4-7",
    });
  });

  it("close() disables writes (logout teardown kill switch)", () => {
    const store = storeAt(tmp);
    store.set({ provider: "anthropic", modelId: "claude-sonnet-4-6" });
    store.close();
    store.set({ provider: "openai-codex", modelId: "gpt-5.5" });
    // A fresh instance sees the pre-close value — the post-close write went
    // nowhere.
    expect(storeAt(tmp).get()).toEqual({ provider: "anthropic", modelId: "claude-sonnet-4-6" });
  });
});
