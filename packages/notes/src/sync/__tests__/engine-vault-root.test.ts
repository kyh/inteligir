// The base anchor belongs to the FOLDER it was taken against. Repointing the
// vault at a different folder must adopt the new folder (push what's there),
// never reconcile it against the old folder's anchor — that reads every path
// the old folder held as a local delete and fans it out to every device.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { InMemorySyncPort, MemoryVault, webCryptoHasher } from "./in-memory-sync-port";
import { SyncEngine, type Clock, type SyncIo } from "../engine";
import { InMemoryBaseStore } from "../base-store";
import { InMemoryBaseBlobStore } from "../blob-store";

const VAULT_ID = "vault-1";
const fixedStamp: Clock = () => "2026-07-05T12-34-56-000Z";

let vault: MemoryVault;
let base: InMemoryBaseStore;
let blobs: InMemoryBaseBlobStore;
let port: InMemorySyncPort;
let root: string;

function newEngine(): SyncEngine {
  const io: SyncIo = { ...vault.io, root: () => root };
  return new SyncEngine({
    vaultId: VAULT_ID,
    port,
    io,
    base,
    blobs,
    hash: webCryptoHasher(),
    stamp: fixedStamp,
    debounceMs: 0,
  });
}

beforeEach(() => {
  vault = new MemoryVault();
  base = new InMemoryBaseStore();
  blobs = new InMemoryBaseBlobStore();
  port = new InMemorySyncPort(VAULT_ID);
  root = "/vaults/first";
});

describe("SyncEngine base anchor vs. the live vault root", () => {
  it("records the root the anchor was taken against", async () => {
    vault.writeText("a.md", "AAA");
    await newEngine().syncOnce();

    expect(base.load()?.vaultRoot).toBe("/vaults/first");
  });

  it("deletes nothing when the vault is repointed at a different folder", async () => {
    vault.writeText("a.md", "AAA");
    vault.writeText("notes/b.md", "BBB");
    await newEngine().syncOnce();

    // The user picks a new vault folder: a different, smaller set of files.
    root = "/vaults/second";
    vault.delete("a.md");
    vault.delete("notes/b.md");
    vault.writeText("c.md", "CCC");
    const deleteSpy = vi.spyOn(port, "deleteFile");

    const out = await newEngine().syncOnce();

    expect(out.status).toBe("ok");
    if (out.status !== "ok") return;
    expect(out.deleted).toBe(0);
    expect(deleteSpy).not.toHaveBeenCalled();
    // The old folder's files survive on the coordinator; the new one is adopted.
    const manifest = await port.listManifest();
    expect(manifest.files.map((file) => file.path).toSorted()).toEqual([
      "a.md",
      "c.md",
      "notes/b.md",
    ]);
  });

  // An anchor predating the recorded root is every existing install's first pass
  // after upgrade. It is already scoped by vaultId to a file this install wrote,
  // so it is KEPT — discarding it would re-push every vault on earth once.
  it("keeps an anchor with no recorded root, and still propagates a real delete", async () => {
    vault.writeText("a.md", "AAA");
    await newEngine().syncOnce();

    const stored = base.load();
    if (stored === null) throw new Error("expected a stored anchor");
    base.save({ vaultId: VAULT_ID, vaultRoot: null, files: stored.files });

    vault.delete("a.md");
    vault.writeText("b.md", "BBB");
    const out = await newEngine().syncOnce();

    expect(out.status === "ok" && out.deleted).toBe(1);
  });

  it("keeps the anchor when the root is unchanged", async () => {
    vault.writeText("a.md", "AAA");
    await newEngine().syncOnce();

    vault.delete("a.md");
    vault.writeText("b.md", "BBB");
    const out = await newEngine().syncOnce();

    // Same folder — a real local delete still propagates.
    expect(out.status === "ok" && out.deleted).toBe(1);
  });
});
