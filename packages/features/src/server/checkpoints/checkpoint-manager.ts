// ---------------------------------------------------------------------------
// CheckpointManager — pre-write checkpoints for CHAT-agent vault edits, the
// undo the delegation dock's "Restore original" never covered.
//
// The privacy tool gate (agent/privacy/extension.ts) invokes capture() for
// every ALLOWED pi edit/write whose parity-resolved target is an in-vault doc,
// strictly before pi executes the tool. The pre-write bytes land in the shared
// SnapshotStore under origin "chat"; a renderer-facing notifier announces each
// capture so the post-turn undo toast can offer "Undo" (the renderer groups
// captures per turn — first capture per path = the pre-turn bytes).
//
// A NEW-FILE `write` (nothing existed to copy) is recorded as kind "create":
// undo means deleting the file, routed to the OS trash like every other
// user-initiated delete (CLAUDE.md § Decisions). An `edit` on a missing file
// captures nothing — pi's edit tool ENOENTs, so there is no write to protect.
// Any other read failure THROWS: the gate lets it propagate and pi blocks the
// call (fail-closed — an AI edit with no undo point must never happen).
// ---------------------------------------------------------------------------

import crypto from "node:crypto";

import { getHostNotifiers } from "../host-notifiers";
import { isEnoent } from "../lib/fs-errors";
import { getSnapshotStore, type SnapshotStore } from "../snapshots/snapshot-store";
import { getVaultManager } from "../vault/vault";
import type { VaultDocWrite } from "../agent/extension";
import { toErrorMessage } from "@repo/features/ipc";
import type { AgentEditCaptured, RestoreAgentEditsResult } from "@repo/features/ipc-registry";

export type CheckpointManagerOptions = {
  /** Snapshot store. Defaults to the shared ~/.inteligir-backed singleton. */
  snapshots?: SnapshotStore;
  /** Read a vault file's raw text (throws ENOENT when absent). Defaults to
   * the live VaultManager. */
  readVault?: (rel: string) => string;
  /** Write a vault file (atomic; the open-note watcher broadcasts). Defaults
   * to the live VaultManager — restore goes through here so an open editor
   * refreshes via the standard external-change path. */
  writeVault?: (rel: string, content: string) => void;
  /** Move a vault file to the OS trash (undo of a kind:"create" checkpoint).
   * Defaults to the live VaultManager's trash. */
  trashVault?: (rel: string) => Promise<boolean>;
  /** Push channel for the renderer's undo toast — a chat write was
   * checkpointed. Injected at construction by the composition root (same
   * story as the delegation manager's notifiers); unit tests leave it unset. */
  onCaptured?: (event: AgentEditCaptured) => void;
};

export class CheckpointManager {
  private readonly snapshots: SnapshotStore;
  private readonly readVault: (rel: string) => string;
  private readonly writeVault: (rel: string, content: string) => void;
  private readonly trashVault: (rel: string) => Promise<boolean>;
  private readonly onCaptured: ((event: AgentEditCaptured) => void) | null;

  constructor(opts: CheckpointManagerOptions = {}) {
    this.snapshots = opts.snapshots ?? getSnapshotStore();
    this.readVault = opts.readVault ?? ((rel) => getVaultManager().readText(rel));
    this.writeVault =
      opts.writeVault ?? ((rel, content) => getVaultManager().writeText(rel, content));
    this.trashVault = opts.trashVault ?? ((rel) => getVaultManager().trash(rel));
    this.onCaptured = opts.onCaptured ?? null;
  }

  /** Capture the pre-write state of an allowed chat-agent edit/write. Called
   * by the tool gate PRE-EXECUTION. Throws on any failure other than a
   * missing file — the gate propagates the throw and pi blocks the tool call
   * (see the header). */
  capture(target: VaultDocWrite): void {
    let content: string | null;
    try {
      content = this.readVault(target.rel);
    } catch (err) {
      // Absent is a legitimate pre-write state; anything else (EISDIR,
      // permissions, confinement) means we can't prove an undo point exists —
      // let it throw and block the write.
      if (!isEnoent(err)) throw err;
      content = null;
    }
    // An edit of a missing file has no write to protect: pi's edit tool will
    // ENOENT without touching disk. Only `write` creates.
    if (content === null && target.tool === "edit") return;
    const kind = content === null ? ("create" as const) : ("edit" as const);
    const id = crypto.randomUUID();
    this.snapshots.capture({ id, origin: "chat", path: target.rel, kind }, content ?? "");
    const event: AgentEditCaptured = {
      id,
      path: target.rel,
      kind,
      capturedAt: Date.now(),
    };
    // Notification is best-effort — a renderer-side failure must never block
    // the agent's write (the checkpoint itself is already on disk).
    try {
      this.onCaptured?.(event);
    } catch (err) {
      console.warn("[checkpoints] capture notification failed:", err);
    }
  }

  /** Undo a set of chat checkpoints (the renderer sends one id per touched
   * file — the FIRST capture of the turn, whose bytes are the pre-turn
   * state). `edit` writes the pre-write bytes back through the vault's atomic
   * write (no-op when the file already matches — no watcher churn); `create`
   * moves the created file to the OS trash (already-gone counts as done).
   * Only chat-origin snapshots are restorable here: delegation restore lives
   * behind its own channel WITH its run-state guard, which this one must not
   * bypass. Failures aggregate into one message — partial success still
   * restores what it can. */
  async restore(ids: string[]): Promise<RestoreAgentEditsResult> {
    const failures: string[] = [];
    for (const id of ids) {
      const snapshot = this.snapshots.read(id);
      if (!snapshot.ok) {
        failures.push(snapshot.error);
        continue;
      }
      if (snapshot.origin !== "chat") {
        failures.push("Not a chat edit — use the delegation dock to restore it.");
        continue;
      }
      try {
        if (snapshot.kind === "create") {
          // Undo of a created file = delete it, recoverably (OS trash).
          await this.trashVault(snapshot.path);
        } else {
          let current: string | null;
          try {
            current = this.readVault(snapshot.path);
          } catch {
            current = null; // deleted since — the write below recreates it
          }
          if (current !== snapshot.content) {
            this.writeVault(snapshot.path, snapshot.content);
          }
        }
      } catch (err) {
        failures.push(`Couldn't restore ${snapshot.path}: ${toErrorMessage(err)}`);
      }
    }
    return failures.length === 0 ? { ok: true } : { ok: false, error: failures.join(" ") };
  }
}

// ---------------------------------------------------------------------------
// Lazy singleton — mirrors the delegation manager: the notifier is read from
// the host bundle at first construction, and reset on logout teardown.
// ---------------------------------------------------------------------------

let instance: CheckpointManager | null = null;

export function getCheckpointManager(): CheckpointManager {
  if (!instance) {
    const notifiers = getHostNotifiers();
    instance = new CheckpointManager(notifiers ? { onCaptured: notifiers.agentEditCaptured } : {});
  }
  return instance;
}

export function resetCheckpointManager(): void {
  instance = null;
}
