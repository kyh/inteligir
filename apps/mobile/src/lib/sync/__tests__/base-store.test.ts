import { describe, expect, it } from "vitest";

import type { VaultManifest } from "@repo/core/sync/manifest";

import { createBaseStore } from "../base-store";
import { fakeJsonFile } from "./fakes";

const HASH = "a".repeat(64);
const MANIFEST: VaultManifest = {
  vaultId: "vault-1",
  generation: 3,
  files: [
    { path: "a.md", contentHash: HASH, version: 2, size: 5 },
    { path: "notes/b.md", contentHash: "b".repeat(64), version: 1, size: 9 },
  ],
};

describe("createBaseStore", () => {
  it("returns null when the file is absent", () => {
    const store = createBaseStore(fakeJsonFile().file);
    expect(store.load()).toBeNull();
  });

  it("round-trips a saved manifest as JSON", () => {
    const backing = fakeJsonFile();
    const store = createBaseStore(backing.file);
    store.save(MANIFEST);
    expect(backing.peek()).toBe(JSON.stringify(MANIFEST));
    expect(store.load()).toEqual(MANIFEST);
  });

  it("returns null on corrupt JSON (base is a pure cache — re-sync from empty)", () => {
    const backing = fakeJsonFile();
    backing.file.write("{ not json");
    expect(createBaseStore(backing.file).load()).toBeNull();
  });

  it("returns null on a structurally invalid manifest (bad content hash)", () => {
    const backing = fakeJsonFile();
    backing.file.write(
      JSON.stringify({
        vaultId: "vault-1",
        generation: 0,
        files: [{ path: "a.md", contentHash: "nothex", version: 1, size: 1 }],
      }),
    );
    expect(createBaseStore(backing.file).load()).toBeNull();
  });

  it("returns null when required fields are missing", () => {
    const backing = fakeJsonFile();
    backing.file.write(JSON.stringify({ vaultId: "vault-1", files: [] }));
    expect(createBaseStore(backing.file).load()).toBeNull();
  });
});
