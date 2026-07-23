import { describe, expect, it } from "vitest";

import type { VaultManifest } from "../manifest";
import { createJsonFileBaseStore, type JsonFile } from "../base-store";

const HASH = "a".repeat(64);
const MANIFEST: VaultManifest = {
  vaultId: "vault-1",
  files: [
    { path: "a.md", contentHash: HASH, version: 2, size: 5 },
    { path: "notes/b.md", contentHash: "b".repeat(64), version: 1, size: 9 },
  ],
};

/** An in-memory `JsonFile` fake. `peek()` reveals the stored text for assertions. */
function fakeJsonFile(): { readonly file: JsonFile; peek(): string | null } {
  let current: string | null = null;
  return {
    file: {
      read: () => current,
      write: (text) => {
        current = text;
      },
    },
    peek: () => current,
  };
}

describe("createJsonFileBaseStore", () => {
  it("returns null when the file is absent", () => {
    const store = createJsonFileBaseStore(fakeJsonFile().file);
    expect(store.load()).toBeNull();
  });

  it("round-trips a saved manifest as JSON", () => {
    const backing = fakeJsonFile();
    const store = createJsonFileBaseStore(backing.file);
    store.save(MANIFEST);
    expect(backing.peek()).toBe(JSON.stringify(MANIFEST));
    expect(store.load()).toEqual(MANIFEST);
  });

  it("returns null on corrupt JSON (base is a pure cache — re-sync from empty)", () => {
    const backing = fakeJsonFile();
    backing.file.write("{ not json");
    expect(createJsonFileBaseStore(backing.file).load()).toBeNull();
  });

  it("returns null on a structurally invalid manifest (bad content hash)", () => {
    const backing = fakeJsonFile();
    backing.file.write(
      JSON.stringify({
        vaultId: "vault-1",
        files: [{ path: "a.md", contentHash: "nothex", version: 1, size: 1 }],
      }),
    );
    expect(createJsonFileBaseStore(backing.file).load()).toBeNull();
  });

  it("returns null when required fields are missing", () => {
    const backing = fakeJsonFile();
    backing.file.write(JSON.stringify({ vaultId: "vault-1" }));
    expect(createJsonFileBaseStore(backing.file).load()).toBeNull();
  });
});
