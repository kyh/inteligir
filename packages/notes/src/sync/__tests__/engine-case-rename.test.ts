// A peer's case-only rename (`note.md` → `Note.md`) reaches this device as a
// delete of the old spelling plus a pull of the new one. On APFS/NTFS those two
// paths are ONE file, so the order the pass applies them in decides whether the
// device ends up with the note or with nothing — and "nothing" propagates as a
// deletion to every other device on the next pass.

import { beforeEach, describe, expect, it } from "vitest";

import { encode, InMemorySyncPort, webCryptoHasher } from "./in-memory-sync-port";
import { SyncEngine, type Clock, type SyncIo } from "../engine";
import { InMemoryBaseStore } from "../base-store";
import { InMemoryBaseBlobStore } from "../blob-store";
import type { VaultPath } from "../vault-file";

const VAULT_ID = "vault-1";
const fixedStamp: Clock = () => "2026-07-05T12-34-56-000Z";
const dec = new TextDecoder();

/**
 * A vault on a case-insensitive filesystem: paths are matched case-folded, so
 * `note.md` and `Note.md` address the same file. A write to an existing file
 * keeps the name already on disk (what a rename onto a case-variant does on
 * APFS) — the harsher of the two behaviours, and the one that makes a
 * delete-after-write leave the vault empty.
 */
class CaseInsensitiveVault {
  private readonly files = new Map<string, { name: VaultPath; bytes: Uint8Array }>();

  readonly io: SyncIo = {
    list: () => [...this.files.values()].map((entry) => entry.name).toSorted(),
    read: (path) => {
      const entry = this.files.get(path.toLowerCase());
      if (entry === undefined) throw new Error(`read of absent ${path}`);
      return entry.bytes;
    },
    write: (path, content) => {
      const key = path.toLowerCase();
      const name = this.files.get(key)?.name ?? path;
      this.files.set(key, { name, bytes: new Uint8Array(content) });
    },
    remove: (path) => {
      this.files.delete(path.toLowerCase());
    },
  };

  writeText(path: string, text: string): void {
    this.io.write(path, encode(text));
  }

  entries(): { path: string; text: string }[] {
    return [...this.files.values()].map((entry) => ({
      path: entry.name,
      text: dec.decode(entry.bytes),
    }));
  }
}

let vault: CaseInsensitiveVault;
let base: InMemoryBaseStore;
let blobs: InMemoryBaseBlobStore;
let port: InMemorySyncPort;

function newEngine(): SyncEngine {
  return new SyncEngine({
    vaultId: VAULT_ID,
    port,
    io: vault.io,
    base,
    blobs,
    hash: webCryptoHasher(),
    stamp: fixedStamp,
    debounceMs: 0,
  });
}

beforeEach(() => {
  vault = new CaseInsensitiveVault();
  base = new InMemoryBaseStore();
  blobs = new InMemoryBaseBlobStore();
  port = new InMemorySyncPort(VAULT_ID);
});

describe("SyncEngine on a case-insensitive vault", () => {
  it("keeps the file when a peer renames it by case alone", async () => {
    vault.writeText("note.md", "NOTE");
    await newEngine().syncOnce();
    const converged = await port.listManifest();
    const before = converged.files.find((file) => file.path === "note.md");
    expect(before).toBeDefined();
    if (before === undefined) return;

    // The peer's rename, as the coordinator sees it.
    await port.deleteFile("note.md", before.version);
    await port.putFile("Note.md", encode("NOTE"), 0);

    const out = await newEngine().syncOnce();

    expect(out.status).toBe("ok");
    expect(vault.entries()).toEqual([{ path: "Note.md", text: "NOTE" }]);
    expect(base.load()?.files.map((file) => file.path)).toEqual(["Note.md"]);
  });

  it("keeps the file when the rename runs the other way", async () => {
    vault.writeText("Note.md", "NOTE");
    await newEngine().syncOnce();
    const converged = await port.listManifest();
    const before = converged.files.find((file) => file.path === "Note.md");
    expect(before).toBeDefined();
    if (before === undefined) return;

    await port.deleteFile("Note.md", before.version);
    await port.putFile("note.md", encode("NOTE"), 0);

    const out = await newEngine().syncOnce();

    expect(out.status).toBe("ok");
    expect(vault.entries()).toEqual([{ path: "note.md", text: "NOTE" }]);
  });
});
