// The SyncCoordinator's gate + state logic with no live engine: it only builds
// a SyncEngine when enabled AND signed in, so with no token every path stays
// engine-free and observable without touching the vault or the network. The
// engine + node adapters are covered separately (sync-manager.test.ts + the
// @repo/core engine tests).

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { SyncAccount } from "../sync-account";
import { SyncCoordinator } from "../sync-coordinator";
import { installHostNotifiers, type HostNotifiers } from "../../host-notifiers";
import type { SyncState } from "@repo/features/sync";

let tmp: string;
let emitted: SyncState[];

function noopNotifiers(capture: (state: SyncState) => void): HostNotifiers {
  return {
    storeRecovery: () => {},
    vaultChange: () => {},
    delegationsChanged: () => {},
    delegationStream: () => {},
    inlineAiStream: () => {},
    syncStateChanged: capture,
  };
}

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
  installHostNotifiers(noopNotifiers((state) => emitted.push(state)));
});

afterEach(() => {
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
