import { writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { VaultPrefsStore } from "./vault-prefs-store";
import { JsonFileStoreError } from "../json-file-store";
import { makeTempDir } from "../test-support/temp-dir";

const scratch = (): string => makeTempDir("vault-prefs-");

describe("the vault's stored choices", () => {
  it("are no choice until written, and survive a write", () => {
    const store = new VaultPrefsStore(scratch());
    expect(store.read()).toEqual({});
    store.write({ attachments: { kind: "beside-note" } });
    expect(store.read()).toEqual({ attachments: { kind: "beside-note" } });
  });

  it("normalize a folder path the way the vault does", () => {
    const dir = scratch();
    writeFileSync(
      path.join(dir, "vault-prefs.json"),
      JSON.stringify({ attachments: { kind: "folder", path: "media//2026/" } }),
    );
    expect(new VaultPrefsStore(dir).read()).toEqual({
      attachments: { kind: "folder", path: "media/2026" },
    });
  });

  it("refuse malformed bytes rather than reading them as defaults", () => {
    const dir = scratch();
    writeFileSync(path.join(dir, "vault-prefs.json"), "{");
    expect(() => new VaultPrefsStore(dir).read()).toThrow(JsonFileStoreError);
  });

  it("refuse a location they do not know", () => {
    const dir = scratch();
    writeFileSync(
      path.join(dir, "vault-prefs.json"),
      JSON.stringify({ attachments: { kind: "cloud" } }),
    );
    expect(() => new VaultPrefsStore(dir).read()).toThrow(JsonFileStoreError);
  });
});
