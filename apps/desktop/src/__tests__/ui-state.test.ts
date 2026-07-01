import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// ui-state imports @/main/secrets, whose default cipher binds to electron's
// safeStorage; tests inject a fake sink, but the import must resolve.
vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: () => Buffer.alloc(0),
    decryptString: () => "",
  },
}));

import { UiStateManager } from "@/main/ui-state";
import { ELEVENLABS_API_KEY_UI_STATE } from "@repo/core/voice";

type FakeSink = {
  values: Map<string, string>;
  set: (key: string, value: string) => void;
  get: (key: string) => string | null;
  delete: (key: string) => void;
};

function fakeSink(): FakeSink {
  const values = new Map<string, string>();
  return {
    values,
    set: (key, value) => {
      values.set(key, value);
    },
    get: (key) => values.get(key) ?? null,
    delete: (key) => {
      values.delete(key);
    },
  };
}

let storePath: string;

beforeEach(() => {
  storePath = path.join(os.tmpdir(), `ui-state-test-${Date.now()}-${Math.random()}.json`);
});

afterEach(() => {
  fs.rmSync(storePath, { force: true });
});

describe("UiStateManager secret routing", () => {
  it("stores plain keys in ui-state as before", () => {
    const sink = fakeSink();
    const mgr = new UiStateManager(storePath, sink);

    mgr.set("panel.layout", { open: true });

    expect(mgr.getAll()).toEqual({ "panel.layout": { open: true } });
    expect(sink.values.size).toBe(0);
  });

  it("routes a secret key into the sink and persists only a presence marker", () => {
    const sink = fakeSink();
    const mgr = new UiStateManager(storePath, sink);

    mgr.set(ELEVENLABS_API_KEY_UI_STATE, "  sk-elevenlabs-123  ");

    expect(sink.values.get(ELEVENLABS_API_KEY_UI_STATE)).toBe("sk-elevenlabs-123");
    expect(mgr.getAll()[ELEVENLABS_API_KEY_UI_STATE]).toBe(true);
    expect(fs.readFileSync(storePath, "utf8")).not.toContain("sk-elevenlabs-123");
  });

  it("reads the secret back through readSecret, never getAll", () => {
    const sink = fakeSink();
    const mgr = new UiStateManager(storePath, sink);

    mgr.set(ELEVENLABS_API_KEY_UI_STATE, "sk-1");

    expect(mgr.readSecret(ELEVENLABS_API_KEY_UI_STATE)).toBe("sk-1");
    expect(mgr.readSecret("panel.layout")).toBeNull(); // non-secret keys: always null
  });

  it("clears the secret and the marker when set to undefined", () => {
    const sink = fakeSink();
    const mgr = new UiStateManager(storePath, sink);

    mgr.set(ELEVENLABS_API_KEY_UI_STATE, "sk-1");
    mgr.set(ELEVENLABS_API_KEY_UI_STATE, undefined);

    expect(sink.values.has(ELEVENLABS_API_KEY_UI_STATE)).toBe(false);
    expect(ELEVENLABS_API_KEY_UI_STATE in mgr.getAll()).toBe(false);
  });

  it("treats an empty or non-string secret write as removal", () => {
    const sink = fakeSink();
    const mgr = new UiStateManager(storePath, sink);

    mgr.set(ELEVENLABS_API_KEY_UI_STATE, "sk-1");
    mgr.set(ELEVENLABS_API_KEY_UI_STATE, "   ");

    expect(sink.values.has(ELEVENLABS_API_KEY_UI_STATE)).toBe(false);
    expect(ELEVENLABS_API_KEY_UI_STATE in mgr.getAll()).toBe(false);
  });
});

describe("UiStateManager legacy plaintext migration", () => {
  it("moves a pre-existing plaintext key into the sink on construction", () => {
    fs.writeFileSync(
      storePath,
      JSON.stringify({ [ELEVENLABS_API_KEY_UI_STATE]: "sk-legacy", "panel.layout": true }),
    );
    const sink = fakeSink();
    const mgr = new UiStateManager(storePath, sink);

    expect(sink.values.get(ELEVENLABS_API_KEY_UI_STATE)).toBe("sk-legacy");
    expect(mgr.getAll()).toEqual({ [ELEVENLABS_API_KEY_UI_STATE]: true, "panel.layout": true });
    expect(fs.readFileSync(storePath, "utf8")).not.toContain("sk-legacy");
  });

  it("drops a legacy empty-string key without creating a secret", () => {
    fs.writeFileSync(storePath, JSON.stringify({ [ELEVENLABS_API_KEY_UI_STATE]: "  " }));
    const sink = fakeSink();
    const mgr = new UiStateManager(storePath, sink);

    expect(sink.values.size).toBe(0);
    expect(ELEVENLABS_API_KEY_UI_STATE in mgr.getAll()).toBe(false);
  });

  it("leaves an already-migrated marker untouched", () => {
    fs.writeFileSync(storePath, JSON.stringify({ [ELEVENLABS_API_KEY_UI_STATE]: true }));
    const sink = fakeSink();
    const mgr = new UiStateManager(storePath, sink);

    expect(sink.values.size).toBe(0); // no spurious overwrite of the stored secret
    expect(mgr.getAll()[ELEVENLABS_API_KEY_UI_STATE]).toBe(true);
  });
});
