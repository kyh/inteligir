import { beforeEach, describe, expect, it } from "vitest";

import { createJsonFileBaseStore } from "@repo/core/sync/base-store";
import { SyncEngine } from "@repo/core/sync/engine";
import { conflictCopyName } from "@repo/core/sync/reconcile";
// The coordinator fake ships under core's `./sync/testing/*` subpath (test-only
// surface). It mints monotonic versions and honors optimistic concurrency
// exactly like the wire contract.
import { InMemorySyncPort } from "@repo/core/sync/testing/in-memory-sync-port";

import { createFsStamp } from "../clock";
import { createSyncIo } from "../sync-io";
import { fakeJsonFile, memVaultFs, webCryptoHasher } from "./fakes";

const VAULT_ID = "vault-1";
const FIXED_STAMP = createFsStamp(() => new Date("2026-07-05T12:34:56.000Z"));

let vault: ReturnType<typeof memVaultFs>;
let baseFile: ReturnType<typeof fakeJsonFile>;
let port: InMemorySyncPort;

// A fresh engine over the SHARED vault/base/port — two engines share the base
// store so a second one reads the first's persisted anchor (the mobile client
// rebuilds a fresh engine per pass over the same on-disk base).
function newEngine(): SyncEngine {
  return new SyncEngine({
    vaultId: VAULT_ID,
    port,
    io: createSyncIo(vault.fs),
    base: createJsonFileBaseStore(baseFile.file),
    hash: webCryptoHasher(),
    stamp: FIXED_STAMP,
    debounceMs: 0,
  });
}

async function remoteText(path: string): Promise<string | null> {
  const got = await port.getFile(path);
  return got.ok ? new TextDecoder().decode(got.content) : null;
}

beforeEach(() => {
  vault = memVaultFs();
  baseFile = fakeJsonFile();
  port = new InMemorySyncPort(VAULT_ID);
});

describe("SyncEngine over the RN adapters", () => {
  it("first sync pushes every local file to an empty coordinator", async () => {
    vault.writeText("a.md", "AAA");
    vault.writeText("notes/b.md", "BBB");

    const out = await newEngine().syncOnce();

    expect(out).toEqual({ status: "ok", pushed: 2, pulled: 0, deleted: 0, conflicts: 0 });
    expect(await remoteText("a.md")).toBe("AAA");
    expect(await remoteText("notes/b.md")).toBe("BBB");
  });

  it("pulls a coordinator-only file into the local vault", async () => {
    await port.putFile("remote-only.md", new TextEncoder().encode("REMOTE"), 0);

    const out = await newEngine().syncOnce();

    expect(out).toEqual({ status: "ok", pushed: 0, pulled: 1, deleted: 0, conflicts: 0 });
    expect(vault.readText("remote-only.md")).toBe("REMOTE");
  });

  it("is a no-op once both sides have converged (a second engine reads the persisted base)", async () => {
    vault.writeText("a.md", "AAA");
    await newEngine().syncOnce();
    const genAfterFirst = port.currentGeneration();

    const out = await newEngine().syncOnce();

    expect(out).toEqual({ status: "ok", pushed: 0, pulled: 0, deleted: 0, conflicts: 0 });
    expect(port.currentGeneration()).toBe(genAfterFirst);
  });

  it("mirrors a local delete to the coordinator", async () => {
    vault.writeText("gone.md", "bye");
    await newEngine().syncOnce();
    expect(await remoteText("gone.md")).toBe("bye");

    vault.files.delete("gone.md");
    const out = await newEngine().syncOnce();

    expect(out).toEqual({ status: "ok", pushed: 0, pulled: 0, deleted: 1, conflicts: 0 });
    expect(await remoteText("gone.md")).toBeNull();
  });

  it("resolves a both-sides edit: winner keeps the path, loser becomes a conflict copy", async () => {
    vault.writeText("note.md", "base");
    await newEngine().syncOnce();

    // A peer advances the coordinator copy; we edit the same file locally.
    await port.putFile("note.md", new TextEncoder().encode("remote-wins"), 1);
    vault.writeText("note.md", "local-loser");

    const out = await newEngine().syncOnce();

    expect(out.status).toBe("ok");
    if (out.status === "ok") expect(out.conflicts).toBe(1);
    expect(vault.readText("note.md")).toBe("remote-wins");
    // The losing local bytes survive beside it as a conflict copy on both sides.
    const copyPath = conflictCopyName("note.md", FIXED_STAMP());
    expect(vault.readText(copyPath)).toBe("local-loser");
    expect(await remoteText(copyPath)).toBe("local-loser");
  });
});
