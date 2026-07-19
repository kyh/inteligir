// The SyncCoordinator's gate + state logic with no live engine: it only builds
// a SyncEngine when enabled AND signed in, so with no token every path stays
// engine-free and observable without touching the vault or the network. The
// engine + node adapters are covered separately (sync-manager.test.ts + the
// @repo/core engine tests).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { SyncAccount } from "../sync-account";
import { createSyncManager } from "../sync-manager";
import { SyncCoordinator, type SyncEngineFactory } from "../sync-coordinator";
import { subscribeEvents } from "../../events";
import { InMemorySyncPort } from "@repo/core/sync/testing/in-memory-sync-port";
import type { SyncIo } from "@repo/core/sync/engine";
import type { VaultPath } from "@repo/core/sync/vault-file";

let tmp: string;
// onSyncStateChanged payloads captured off the typed event bus (the
// coordinator emits straight to it) — `unknown` because the transport-level
// listener is untyped; assertions compare whole values.
let emitted: unknown[];
let unsubscribeEvents: () => void;

function coordinatorAt(dir: string, listVaultPaths?: () => readonly string[]): SyncCoordinator {
  const account = new SyncAccount({
    configPath: path.join(dir, "sync-config.json"),
    authPath: path.join(dir, "sync-auth.json"),
    vaultIdPath: path.join(dir, "sync-vault-id.json"),
  });
  return listVaultPaths === undefined
    ? new SyncCoordinator(account)
    : new SyncCoordinator(account, listVaultPaths);
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sync-coordinator-"));
  emitted = [];
  unsubscribeEvents = subscribeEvents((method, payload) => {
    if (method === "onSyncStateChanged") emitted.push(payload);
  });
});

afterEach(() => {
  unsubscribeEvents();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("SyncCoordinator", () => {
  it("reports a disabled, signed-out, idle state initially", () => {
    expect(coordinatorAt(tmp).getState()).toEqual({
      enabled: false,
      signedIn: false,
      email: null,
      coordinatorUrl: "",
      status: { phase: "idle" },
      conflicts: [],
    });
  });

  it("seeds unresolved conflicts from the vault listing on start()", () => {
    const copy = "notes/todo (conflict 2026-07-05T12-34-56-000Z).md";
    const coordinator = coordinatorAt(tmp, () => ["notes/todo.md", copy, "plain.md"]);
    // Before start(), nothing has been scanned.
    expect(coordinator.getState().conflicts).toEqual([]);
    coordinator.start();
    const conflicts = coordinator.getState().conflicts;
    expect(conflicts.map((c) => c.path)).toEqual([copy]);
    expect(typeof conflicts[0]?.detectedAt).toBe("string");
  });

  it("drops a conflict row once its copy file leaves the vault", () => {
    const copy = "todo (conflict 2026-07-05T12-34-56-000Z).md";
    let paths: readonly string[] = ["todo.md", copy];
    const coordinator = coordinatorAt(tmp, () => paths);
    coordinator.start();
    expect(coordinator.getState().conflicts.map((c) => c.path)).toEqual([copy]);
    // Deleting the copy (resolving the conflict) prunes the row on the next read.
    paths = ["todo.md"];
    expect(coordinator.getState().conflicts).toEqual([]);
  });

  it("reflects config changes and emits onSyncStateChanged", () => {
    const coordinator = coordinatorAt(tmp);
    const state = coordinator.setConfig({ enabled: true, coordinatorUrl: "https://sync.example" });
    expect(state.enabled).toBe(true);
    expect(state.coordinatorUrl).toBe("https://sync.example");
    expect(state.signedIn).toBe(false);
    // A config change fires the reactive event.
    expect(emitted.at(-1)).toEqual(state);
  });

  it("refuses syncNow while signed out and records the reason", async () => {
    const coordinator = coordinatorAt(tmp);
    coordinator.setConfig({ enabled: true, coordinatorUrl: "https://sync.example" });
    const outcome = await coordinator.syncNow();
    expect(outcome).toEqual({ status: "error", message: "Enable sync and sign in first." });
    expect(coordinator.getState().status).toEqual({
      phase: "error",
      message: "Enable sync and sign in first.",
    });
  });

  it("onVaultChanged is a no-op when no engine is live", () => {
    const coordinator = coordinatorAt(tmp);
    expect(() => coordinator.onVaultChanged()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// A live engine over an in-memory port/vault (no network), wired through the
// injectable `SyncEngineFactory` — proves a DEBOUNCED pass (onVaultChanged,
// never syncNow()) surfaces its conflict into `getState().conflicts` through
// the SAME `onOutcome` path syncNow uses.
// ---------------------------------------------------------------------------

const VAULT_ID = "vault-coordinator-test";

/** A Map-backed SyncIo good enough to drive the engine end-to-end. */
class MemoryVault {
  private readonly files = new Map<VaultPath, Uint8Array>();

  readonly io: SyncIo = {
    list: () => [...this.files.keys()],
    read: (p) => {
      const bytes = this.files.get(p);
      if (bytes === undefined) throw new Error(`MemoryVault: read of absent ${p}`);
      return bytes;
    },
    write: (p, content) => {
      this.files.set(p, new Uint8Array(content));
    },
    remove: (p) => {
      this.files.delete(p);
    },
  };

  writeText(p: string, text: string): void {
    this.files.set(p, new TextEncoder().encode(text));
  }

  readText(p: string): string | null {
    const bytes = this.files.get(p);
    return bytes === undefined ? null : new TextDecoder().decode(bytes);
  }
}

/** Sign in without hitting the network — write the bearer token + a pinned
 * vaultId straight into the store files the account reads from (so the
 * engine's vaultId matches the fake port's, which the engine gates every
 * pass on — see `runOnce`'s vaultId mismatch check). */
function fakeSignIn(dir: string, coordinatorUrl: string, vaultId: string): SyncAccount {
  fs.writeFileSync(
    path.join(dir, "sync-auth.json"),
    JSON.stringify({ version: 1, token: "test-token", email: "test@example.com" }),
  );
  fs.writeFileSync(path.join(dir, "sync-vault-id.json"), JSON.stringify({ version: 1, vaultId }));
  const account = new SyncAccount({
    configPath: path.join(dir, "sync-config.json"),
    authPath: path.join(dir, "sync-auth.json"),
    vaultIdPath: path.join(dir, "sync-vault-id.json"),
  });
  account.setConfig({ enabled: true, coordinatorUrl });
  return account;
}

describe("SyncCoordinator — debounced-pass conflicts (item 2)", () => {
  it("a debounced onVaultChanged pass surfaces a conflict — no explicit syncNow() call", async () => {
    const account = fakeSignIn(tmp, "https://sync.example", VAULT_ID);
    const port = new InMemorySyncPort(VAULT_ID);
    const vault = new MemoryVault();

    const buildEngine: SyncEngineFactory = (opts) =>
      createSyncManager({
        vaultId: opts.vaultId,
        port,
        vault: vault.io,
        basePath: path.join(tmp, "sync-base.json"),
        blobsDir: path.join(tmp, "sync-blobs"),
        debounceMs: 0,
        onOutcome: opts.onOutcome,
      });

    // listVaultPaths must read the SAME fake vault the engine syncs — the
    // default reads the real VaultManager, which would never see the conflict
    // copy the engine writes into `vault.io`, and pruneConflicts() would drop
    // the row instantly on the next getState().
    const coordinator = new SyncCoordinator(account, () => vault.io.list(), buildEngine);

    // 1. Establish a shared base at version 1. Poll on the REMOTE landing the
    // push (rather than the coordinator's status) — the fake port's synchronous
    // `putFile` echoes back through the engine's own remote subscription
    // (self-triggered scheduleSync), so a second, no-op settle pass can
    // overwrite the first pass's status before we get to read it; the file
    // actually reaching the remote is the stable signal that sync ran.
    vault.writeText("note.md", "base");
    coordinator.start();
    for (let i = 0; i < 50 && !(await port.getFile("note.md")).ok; i++) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect((await port.getFile("note.md")).ok).toBe(true);
    if (coordinator.getState().status.phase === "error") {
      throw new Error(`initial sync errored: ${JSON.stringify(coordinator.getState().status)}`);
    }

    // 2. A peer advances the file on the coordinator.
    const bumped = await port.putFile("note.md", new TextEncoder().encode("remote-wins"), 1);
    expect(bumped.ok).toBe(true);

    // 3. Local edits the same file since base, and the ONLY trigger is the
    // debounced onVaultChanged path — never coordinator.syncNow().
    vault.writeText("note.md", "local-loser");
    coordinator.onVaultChanged();

    // Poll for the debounced pass to land (debounceMs: 0, but still a macrotask).
    for (let i = 0; i < 50 && coordinator.getState().conflicts.length === 0; i++) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    // The conflicts LIST is cumulative (what item 2 is about); `status` only
    // ever reflects the MOST RECENT pass, which — because the fake port's
    // synchronous `putFile` self-echoes through the engine's own remote
    // subscription — may be a later no-op settle pass reporting 0 new
    // conflicts. That's expected; the persisted conflicts list is the
    // assertion that matters here.
    const state = coordinator.getState();
    expect(state.conflicts).toHaveLength(1);
    expect(state.status.phase).toBe("ok");
    expect(vault.readText("note.md")).toBe("remote-wins");

    coordinator.dispose();
  });
});

// ---------------------------------------------------------------------------
// Guest→account upgrade (#459): a guest's existing local vault is ADOPTED by
// the first sync after signing in + enabling — pushed to the empty
// coordinator, never wiped or replaced.
// ---------------------------------------------------------------------------

describe("SyncCoordinator — guest→account upgrade", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("adopts the guest's existing local vault on sign-in + enable (pushes, never wipes)", async () => {
    // 1. Guest life: local notes exist, no account, no engine. The vault id
    // is pinned BEFORE the account is constructed so the engine built after
    // sign-in matches the fake port's.
    fs.writeFileSync(
      path.join(tmp, "sync-vault-id.json"),
      JSON.stringify({ version: 1, vaultId: VAULT_ID }),
    );
    const vault = new MemoryVault();
    vault.writeText("journal/2026-07-18.md", "guest note one");
    vault.writeText("ideas.md", "guest note two");

    const account = new SyncAccount({
      configPath: path.join(tmp, "sync-config.json"),
      authPath: path.join(tmp, "sync-auth.json"),
      vaultIdPath: path.join(tmp, "sync-vault-id.json"),
    });
    const port = new InMemorySyncPort(VAULT_ID);
    const buildEngine: SyncEngineFactory = (opts) =>
      createSyncManager({
        vaultId: opts.vaultId,
        port,
        vault: vault.io,
        basePath: path.join(tmp, "sync-base.json"),
        blobsDir: path.join(tmp, "sync-blobs"),
        debounceMs: 0,
        onOutcome: opts.onOutcome,
      });
    const coordinator = new SyncCoordinator(account, () => vault.io.list(), buildEngine);
    coordinator.start();
    expect(coordinator.getState().signedIn).toBe(false);
    // No engine while guest — syncNow refuses, files untouched.
    expect((await coordinator.syncNow()).status).toBe("error");

    // 2. The upgrade, exactly as the settings UI drives it: set the server
    // URL (Account section), sign in through the REAL coordinator.signIn
    // (Better Auth stubbed at the fetch layer — the engine's port is
    // in-memory and never touches fetch), then enable sync (Sync section).
    coordinator.setConfig({ coordinatorUrl: "https://sync.example" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { user: { id: "u1", email: "upgraded@example.com" }, token: "t" },
          { headers: { "set-auth-token": "fresh-token" } },
        ),
      ),
    );
    expect(await coordinator.signIn("upgraded@example.com", "pw")).toEqual({ ok: true });
    coordinator.setConfig({ enabled: true });
    expect(coordinator.getState().signedIn).toBe(true);

    // 3. The initial reconcile ADOPTS the local vault: both guest files land
    // on the (empty) coordinator. Wait for BOTH — the reconcile pushes them
    // independently, so polling only one races the other's push under load.
    for (
      let i = 0;
      i < 100 &&
      !((await port.getFile("ideas.md")).ok && (await port.getFile("journal/2026-07-18.md")).ok);
      i++
    ) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect((await port.getFile("journal/2026-07-18.md")).ok).toBe(true);
    expect((await port.getFile("ideas.md")).ok).toBe(true);

    // ...and the local bytes are byte-identical to before the upgrade —
    // nothing was wiped, replaced, or "migrated".
    expect(vault.readText("journal/2026-07-18.md")).toBe("guest note one");
    expect(vault.readText("ideas.md")).toBe("guest note two");

    coordinator.dispose();
  });
});
