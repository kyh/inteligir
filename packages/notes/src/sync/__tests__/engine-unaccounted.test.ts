// A path the local crawl SAW but could not read as a file — a symlink where a
// note used to be, a cloud placeholder for evicted bytes — is missing from the
// local manifest, which reconcile reads as a local delete. Only a path the LAST
// SYNC recorded can be deleted from anywhere, so only those refuse the pass:
// refusing on every one of them lets a single stray link wedge sync forever.

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
let unaccounted: string[];

function newEngine(): SyncEngine {
  const io: SyncIo = { ...vault.io, unaccounted: () => unaccounted };
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
  unaccounted = [];
});

describe("SyncEngine vs. files the crawl could not account for", () => {
  it("refuses the pass, names the path, and says what to do about it", async () => {
    vault.writeText("a.md", "AAA");
    vault.writeText("b.md", "BBB");
    await newEngine().syncOnce();

    // `a.md` becomes something the crawl cannot present as a file: gone from
    // the listing, reported as unaccounted for instead.
    vault.delete("a.md");
    unaccounted = ["a.md"];
    const deleteSpy = vi.spyOn(port, "deleteFile");

    const out = await newEngine().syncOnce();

    expect(out.status).toBe("error");
    if (out.status !== "error") return;
    expect(out.message).toContain('"a.md"');
    // Actionable for both shapes the port can be reporting.
    expect(out.message).toContain("download");
    expect(out.message).toContain("link");
    // Nothing was deleted anywhere, and the anchor is untouched — the next pass
    // retries from the same clean base.
    expect(deleteSpy).not.toHaveBeenCalled();
    expect((await port.listManifest()).files.map((file) => file.path).toSorted()).toEqual([
      "a.md",
      "b.md",
    ]);
    expect(
      base
        .load()
        ?.files.map((file) => file.path)
        .toSorted(),
    ).toEqual(["a.md", "b.md"]);
  });

  it("ignores an unaccounted-for path the last sync never recorded", async () => {
    vault.writeText("a.md", "AAA");
    // A symlink that was never a synced note. It has never been in a manifest,
    // so leaving it out of one deletes nothing — the common case, and the pass
    // must run normally.
    unaccounted = ["links/elsewhere.md"];

    const out = await newEngine().syncOnce();

    expect(out.status).toBe("ok");
    expect((await port.listManifest()).files.map((file) => file.path)).toEqual(["a.md"]);
  });

  it("resumes as soon as the file is readable again", async () => {
    vault.writeText("a.md", "AAA");
    await newEngine().syncOnce();

    vault.delete("a.md");
    unaccounted = ["a.md"];
    expect((await newEngine().syncOnce()).status).toBe("error");

    // The user downloads the evicted file / restores the real note.
    vault.writeText("a.md", "AAA2");
    unaccounted = [];
    const out = await newEngine().syncOnce();

    expect(out.status).toBe("ok");
    expect(out.status === "ok" && out.pushed).toBe(1);
  });

  it("still propagates a genuine local delete of a different file", async () => {
    vault.writeText("a.md", "AAA");
    vault.writeText("b.md", "BBB");
    await newEngine().syncOnce();

    // `linked.md` was never synced; `b.md` really was deleted.
    unaccounted = ["linked.md"];
    vault.delete("b.md");

    const out = await newEngine().syncOnce();

    expect(out.status === "ok" && out.deleted).toBe(1);
    expect((await port.listManifest()).files.map((file) => file.path)).toEqual(["a.md"]);
  });
});

// A synced subtree replaced by a symlink to it: the crawl reports the DIRECTORY
// as one unaccounted path, so an exact-membership check sees no overlap with
// `notes/a.md` and deletes the whole subtree.
describe("unaccounted directories", () => {
  it("refuses when an unaccounted DIRECTORY covers a base path", async () => {
    vault.writeText("notes/a.md", "AAA");
    vault.writeText("top.md", "TOP");
    await newEngine().syncOnce();

    vault.delete("notes/a.md");
    const deleteSpy = vi.spyOn(port, "deleteFile");
    unaccounted = ["notes"];
    const out = await newEngine().syncOnce();

    expect(out.status).toBe("error");
    expect(out.status === "error" && out.message).toContain("notes/a.md");
    expect(deleteSpy).not.toHaveBeenCalled();
  });

  it("does not refuse for an unaccounted directory holding nothing synced", async () => {
    vault.writeText("top.md", "TOP");
    await newEngine().syncOnce();

    unaccounted = ["scratch"];
    const out = await newEngine().syncOnce();

    expect(out.status).toBe("ok");
  });
});
