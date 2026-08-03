// The deletion gate: the layer that bounds what a leaked listing invariant
// costs. Every mass-deletion bug this vault has shipped looked like a
// legitimate plan to the crawl that produced it, so these tests never simulate
// a cause — they assert on the SIZE of the plan alone: an implausible deletion
// applies NOTHING (not the deletes, not the writes beside them), leaves the
// base anchor exactly as it was, and waits for a human. The complements matter
// as much: an ordinary cleanup must not be held, a confirmation must cover only
// the count it was shown, no automatic trigger may ever confirm one, and the
// two listing guards must still run first.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { InMemorySyncPort, MemoryVault, webCryptoHasher } from "./in-memory-sync-port";
import { SyncEngine, type Clock, type SyncIo, type SyncOutcome } from "../engine";
import { InMemoryBaseStore } from "../base-store";
import { InMemoryBaseBlobStore } from "../blob-store";

const VAULT_ID = "vault-1";
const fixedStamp: Clock = () => "2026-07-05T12-34-56-000Z";

let vault: MemoryVault;
let base: InMemoryBaseStore;
let blobs: InMemoryBaseBlobStore;
let port: InMemorySyncPort;
let unaccounted: string[];

function newEngine(onOutcome?: (outcome: SyncOutcome) => void): SyncEngine {
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
    onOutcome,
  });
}

/** Converge `count` notes so the base anchor records them all. */
async function seedVault(count: number): Promise<void> {
  for (let i = 0; i < count; i += 1) vault.writeText(`n${i}.md`, `body ${i}`);
  expect((await newEngine().syncOnce()).status).toBe("ok");
}

/** Delete `n<from>.md` … `n<to - 1>.md` from the local vault. */
function deleteLocal(from: number, to: number): void {
  for (let i = from; i < to; i += 1) vault.delete(`n${i}.md`);
}

async function remotePaths(): Promise<string[]> {
  return (await port.listManifest()).files.map((file) => file.path).toSorted();
}

beforeEach(() => {
  vault = new MemoryVault();
  base = new InMemoryBaseStore();
  blobs = new InMemoryBaseBlobStore();
  port = new InMemorySyncPort(VAULT_ID);
  unaccounted = [];
});

describe("SyncEngine deletion gate", () => {
  it("holds an over-threshold plan and applies NOTHING", async () => {
    await seedVault(60);
    const baseBefore = base.load();
    deleteLocal(0, 30);
    // A write alongside the deletions: a held plan is held whole, so this must
    // not reach the coordinator either.
    vault.writeText("new.md", "fresh");
    const deleteSpy = vi.spyOn(port, "deleteFile");
    const putSpy = vi.spyOn(port, "putFile");

    const out = await newEngine().syncOnce();

    expect(out).toEqual({
      status: "held",
      deletions: 30,
      baseCount: 60,
      sample: ["n0.md", "n1.md", "n10.md", "n11.md", "n12.md"],
    });
    expect(deleteSpy).not.toHaveBeenCalled();
    expect(putSpy).not.toHaveBeenCalled();
    expect(await remotePaths()).toHaveLength(60);
    // The anchor is untouched, so a retry reconciles from the same clean base.
    expect(base.load()).toEqual(baseBefore);
  });

  it("applies an ordinary cleanup below the floor untouched", async () => {
    // The floor is set high on purpose: clearing out a season of daily notes is
    // a normal act and must never draw a confirmation, or the confirmation
    // becomes something the user learns to click through.
    await seedVault(30);
    deleteLocal(0, 20);

    const out = await newEngine().syncOnce();

    expect(out).toMatchObject({ status: "ok", deleted: 20 });
    expect(await remotePaths()).toHaveLength(10);
  });

  it("applies a large-vault delete that stays under the proportional share", async () => {
    // 600 files → the share (30) has overtaken the floor (25); 28 clears the
    // floor but stays under the share, so only the proportion lets it through.
    await seedVault(600);
    deleteLocal(0, 28);

    const out = await newEngine().syncOnce();

    expect(out).toMatchObject({ status: "ok", deleted: 28 });
    expect(await remotePaths()).toHaveLength(572);
  });

  it("counts remote-side deletions too — a peer's mass delete is held locally", async () => {
    await seedVault(60);
    // A peer removes half the vault from the coordinator; reconcile would
    // mirror that by deleting the local copies.
    const manifest = await port.listManifest();
    for (const file of manifest.files.slice(0, 30)) {
      expect((await port.deleteFile(file.path, file.version)).ok).toBe(true);
    }

    const out = await newEngine().syncOnce();

    expect(out).toMatchObject({ status: "held", deletions: 30, baseCount: 60 });
    expect(vault.paths()).toHaveLength(60);
  });

  it("a confirmed pass applies exactly what was held", async () => {
    await seedVault(60);
    deleteLocal(0, 30);
    const held = await newEngine().syncOnce();
    expect(held).toMatchObject({ status: "held", deletions: 30 });

    const confirmed = await newEngine().syncOnce({ confirmDeletions: 30 });

    expect(confirmed).toMatchObject({ status: "ok", deleted: 30, pushed: 0, pulled: 0 });
    expect(await remotePaths()).toEqual(vault.paths());
    expect(await remotePaths()).toHaveLength(30);
  });

  it("a confirmation covers only the count it was shown — a grown plan holds again", async () => {
    // The waiver is bound to what the user SAW. A confirmed pass re-crawls and
    // re-reconciles, so a listing that degraded between the hold and the click
    // must not ride the old approval: it holds again with the new number, which
    // is the number the user then gets to approve.
    await seedVault(60);
    deleteLocal(0, 30);
    expect(await newEngine().syncOnce()).toMatchObject({ status: "held", deletions: 30 });
    const baseBefore = base.load();

    deleteLocal(30, 40);
    const deleteSpy = vi.spyOn(port, "deleteFile");
    const out = await newEngine().syncOnce({ confirmDeletions: 30 });

    expect(out).toMatchObject({ status: "held", deletions: 40, baseCount: 60 });
    expect(deleteSpy).not.toHaveBeenCalled();
    expect(await remotePaths()).toHaveLength(60);
    expect(base.load()).toEqual(baseBefore);
  });

  it("confirmation is per-pass — the NEXT pass is gated again", async () => {
    await seedVault(60);
    deleteLocal(0, 30);
    expect((await newEngine().syncOnce({ confirmDeletions: 30 })).status).toBe("ok");

    // A second mass deletion against the newly converged anchor: nothing about
    // the earlier confirmation carries over.
    deleteLocal(30, 56);
    const out = await newEngine().syncOnce();

    expect(out).toMatchObject({ status: "held", deletions: 26, baseCount: 30 });
  });

  it("holds a whole-vault deletion behind the EMPTY-listing guard, not this one", async () => {
    // Layer 1 still owns the empty listing — the gate must not have absorbed
    // it, because that guard refuses even a confirmed pass.
    await seedVault(30);
    deleteLocal(0, 30);

    const out = await newEngine().syncOnce({ confirmDeletions: 30 });

    expect(out).toMatchObject({
      status: "error",
      message: expect.stringContaining("mass deletion"),
    });
    expect(await remotePaths()).toHaveLength(30);
  });

  it("holds behind the UNACCOUNTED-in-base refusal, not this one", async () => {
    // Layer 2 keeps its precedence too. A confirmed pass whose plan the gate
    // would have waived must still refuse for the unreadable path, because a
    // path the crawl could not read is not a path the user deleted — and the
    // remedy the refusal names is the actionable one.
    await seedVault(60);
    deleteLocal(0, 30);
    unaccounted = ["n0.md"];
    const baseBefore = base.load();
    const deleteSpy = vi.spyOn(port, "deleteFile");

    const out = await newEngine().syncOnce({ confirmDeletions: 30 });

    expect(out).toMatchObject({ status: "error", message: expect.stringContaining('"n0.md"') });
    expect(deleteSpy).not.toHaveBeenCalled();
    expect(await remotePaths()).toHaveLength(60);
    expect(base.load()).toEqual(baseBefore);
  });

  it("an automatic (debounced) pass never confirms — it reports the hold", async () => {
    await seedVault(60);
    deleteLocal(0, 30);

    const outcomes: SyncOutcome[] = [];
    let resolveSeen: (() => void) | null = null;
    const seen = new Promise<void>((resolve) => {
      resolveSeen = resolve;
    });
    const engine = newEngine((outcome) => {
      outcomes.push(outcome);
      resolveSeen?.();
    });

    engine.scheduleSync();
    await seen;

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]).toMatchObject({ status: "held", deletions: 30 });
    expect(await remotePaths()).toHaveLength(60);
  });
});
