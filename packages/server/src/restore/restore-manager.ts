// ---------------------------------------------------------------------------
// RestoreManager — the ONE capture/restore API behind every AI-edit undo.
//
// Both AI surfaces that write vault files call in here, parameterized by
// origin, and both restore paths read back through here:
//   - "chat": the privacy tool gate (agent/privacy/extension.ts) invokes
//     capture() for every ALLOWED pi edit/write whose parity-resolved target
//     is an in-vault doc, strictly before pi executes the tool. A
//     renderer-facing notifier announces each capture so the post-turn undo
//     toast can offer "Undo" (the renderer groups captures per turn — first
//     capture per path = the pre-turn bytes); restoreChatEdits() is that
//     toast's restore.
//   - "delegation": the delegation-manager captures the target file's
//     resolved bytes at run START (id = the delegation id) and never fires
//     the toast notifier — delegation's undo surface is the dock's "Restore
//     original", which lands in restoreDelegationSnapshot() behind the
//     manager's own run-state guard.
// The bytes live in the SnapshotStore (snapshot-store.ts) either way — one
// store, one retention sweep, one rename remap.
//
// A NEW-FILE chat `write` (nothing existed to copy) is recorded as kind
// "create": undo means deleting the file, routed to the OS trash like every
// other user-initiated delete (CLAUDE.md § Decisions). An `edit` on a missing
// file captures nothing — pi's edit tool ENOENTs, so there is no write to
// protect. Any other read failure THROWS: the gate lets it propagate and pi
// blocks the call (fail-closed — an AI edit with no undo point must never
// happen). The delegation variant throws on any capture failure for the same
// reason: the delegation-manager aborts the run rather than dispatch an agent
// whose edit the user can't revert.
// ---------------------------------------------------------------------------

import crypto from "node:crypto";

import { emitEvent } from "../events";
import { isEnoent } from "@repo/storage/fs-errors";
import { getSnapshotStore, type SnapshotStore } from "./snapshot-store";
import { getVaultManager } from "@repo/vault/vault";
import type { VaultDocWrite } from "@repo/agent/extension";
import { toErrorMessage } from "@repo/bridge/wire-helpers";
import type { AgentEditCaptured, RestoreAgentEditsResult } from "@repo/bridge/ipc-registry";
import type { RestoreSnapshotResult } from "@repo/bridge/delegation";

/** A pre-AI-write capture request, discriminated by origin (see the header).
 * Chat captures read the vault themselves (the gate hands over only the tool
 * target); delegation captures carry the exact bytes the run was resolved
 * against, so the snapshot can never race a write between resolve and
 * dispatch. */
export type RestoreCapture =
  | { origin: "chat"; target: VaultDocWrite }
  | { origin: "delegation"; id: string; path: string; content: string }
  // Routine pre-run capture: the routines-manager resolved the target itself
  // (same no-race contract as delegation). `content: null` = the target did
  // not exist yet (a daily note before its first write) → kind "create", so
  // restore deletes rather than writes an empty file.
  | { origin: "routine"; id: string; path: string; content: string | null };

export type RestoreManagerOptions = {
  /** Snapshot store. Defaults to the shared ~/.inteligir-backed singleton. */
  snapshots?: SnapshotStore;
  /** Read a vault file's raw text (throws ENOENT when absent). Defaults to
   * the live VaultManager. */
  readVault?: (rel: string) => string;
  /** Write a vault file (atomic; the open-note watcher broadcasts). Defaults
   * to the live VaultManager — restore goes through here so an open editor
   * refreshes via the standard external-change path. */
  writeVault?: (rel: string, content: string) => void;
  /** Move a vault file to the OS trash (undo of a kind:"create" capture).
   * Defaults to the live VaultManager's trash. */
  trashVault?: (rel: string) => Promise<boolean>;
  /** Push channel for the renderer's undo toast — a chat write was captured.
   * The live singleton wires it to the typed emitEvent (same story as the
   * delegation manager's channels); unit tests leave it unset. Delegation
   * captures never fire it — they must not leak into the chat undo toast. */
  onCaptured?: (event: AgentEditCaptured) => void;
};

export class RestoreManager {
  private readonly snapshots: SnapshotStore;
  private readonly readVault: (rel: string) => string;
  private readonly writeVault: (rel: string, content: string) => void;
  private readonly trashVault: (rel: string) => Promise<boolean>;
  private readonly onCaptured: ((event: AgentEditCaptured) => void) | null;

  constructor(opts: RestoreManagerOptions = {}) {
    this.snapshots = opts.snapshots ?? getSnapshotStore();
    this.readVault = opts.readVault ?? ((rel) => getVaultManager().readText(rel));
    this.writeVault =
      opts.writeVault ?? ((rel, content) => getVaultManager().writeText(rel, content));
    this.trashVault = opts.trashVault ?? ((rel) => getVaultManager().trash(rel));
    this.onCaptured = opts.onCaptured ?? null;
  }

  /** Capture the pre-write state of an AI edit. Throws on any failure other
   * than a missing chat-edit file — the chat gate propagates the throw and pi
   * blocks the tool call; the delegation-manager aborts the run (see the
   * header). */
  capture(request: RestoreCapture): void {
    if (request.origin === "delegation") {
      // Bytes provided by the caller (the exact content the run was resolved
      // against); a store failure throws through to abort the run.
      this.snapshots.capture(
        { id: request.id, origin: "delegation", path: request.path, kind: "edit" },
        request.content,
      );
      return;
    }
    if (request.origin === "routine") {
      // Same provided-bytes contract as delegation; null = target absent →
      // "create", whose restore is a delete. Throws through to abort the run.
      this.snapshots.capture(
        {
          id: request.id,
          origin: "routine",
          path: request.path,
          kind: request.content === null ? "create" : "edit",
        },
        request.content ?? "",
      );
      return;
    }
    const target = request.target;
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
    // the agent's write (the capture itself is already on disk).
    try {
      this.onCaptured?.(event);
    } catch (err) {
      console.warn("[restore] capture notification failed:", err);
    }
  }

  /** Undo a set of chat captures (the renderer sends one id per touched
   * file — the FIRST capture of the turn, whose bytes are the pre-turn
   * state). `edit` writes the pre-write bytes back through the vault's atomic
   * write (no-op when the file already matches — no watcher churn); `create`
   * moves the created file to the OS trash (already-gone counts as done).
   * Only chat-origin snapshots are restorable here: delegation restore lives
   * behind its own channel WITH its run-state guard, which this one must not
   * bypass. Failures aggregate into one message — partial success still
   * restores what it can. */
  async restoreChatEdits(ids: string[]): Promise<RestoreAgentEditsResult> {
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

  /** Write a delegation's pre-run bytes back to `targetPath` — the byte-level
   * half of the dock's "Restore original". The caller (delegation-manager)
   * owns the record side: it refuses while the run is queued/running and
   * passes the delegation's CURRENT sourceFile (renameSource keeps it
   * pointing at the moved file), then records `restoredAt` on success. The
   * write goes through the vault's atomic write (the watcher refreshes
   * editors naturally) and recreates the file if it was deleted since; when
   * the file already matches the snapshot this is a no-op success (no write,
   * no watcher churn). */
  restoreDelegationSnapshot(id: string, targetPath: string): RestoreSnapshotResult {
    const snapshot = this.snapshots.read(id);
    if (!snapshot.ok) return { ok: false, error: snapshot.error };
    if (snapshot.origin !== "delegation") {
      // Unreachable through the dock (delegation ids key delegation-origin
      // snapshots), kept for symmetry with the chat-side origin guard.
      return { ok: false, error: "Not a delegation edit." };
    }
    // Byte-equality IS hash-equality here — the snapshot's recorded hash was
    // already verified against its content in read().
    let current: string | null;
    try {
      current = this.readVault(targetPath);
    } catch {
      current = null; // deleted (or unreadable) — the write below recreates it
    }
    if (current !== snapshot.content) {
      try {
        this.writeVault(targetPath, snapshot.content);
      } catch (err) {
        return { ok: false, error: `Couldn't restore ${targetPath}: ${toErrorMessage(err)}` };
      }
    }
    return { ok: true };
  }

  /** Write a routine run's pre-run bytes back to `targetPath` — the byte-level
   * half of Settings → Routines "Restore". The caller (routines-manager) owns
   * the record side (refuses while that routine is running, records
   * restoredAt). An `edit` snapshot writes back atomically like the
   * delegation path; a `create` snapshot (the target didn't exist pre-run)
   * undoes by moving the created file to the OS trash — already-gone counts
   * as done, mirroring the chat create-undo. */
  async restoreRoutineSnapshot(id: string, targetPath: string): Promise<RestoreSnapshotResult> {
    const snapshot = this.snapshots.read(id);
    if (!snapshot.ok) return { ok: false, error: snapshot.error };
    if (snapshot.origin !== "routine") {
      // Unreachable through Settings (runIds key routine-origin snapshots),
      // kept for symmetry with the other origin guards.
      return { ok: false, error: "Not a routine edit." };
    }
    try {
      if (snapshot.kind === "create") {
        await this.trashVault(targetPath);
        return { ok: true };
      }
      let current: string | null;
      try {
        current = this.readVault(targetPath);
      } catch {
        current = null; // deleted (or unreadable) — the write below recreates it
      }
      if (current !== snapshot.content) {
        this.writeVault(targetPath, snapshot.content);
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: `Couldn't restore ${targetPath}: ${toErrorMessage(err)}` };
    }
  }

  /** A vault file/folder was renamed/moved — repoint snapshot entry paths so
   * a later restore targets the moved file. */
  renamePath(from: string, to: string): void {
    this.snapshots.renamePath(from, to);
  }

  /** Retention sweep (see SNAPSHOT_RETENTION) — returns the pruned ids so the
   * delegation-manager can clear `hasSnapshot` on affected records. */
  prune(): string[] {
    return this.snapshots.prune();
  }
}

// ---------------------------------------------------------------------------
// Lazy singleton — mirrors the delegation manager: the capture channel wires
// straight to the typed event bus, and reset on logout teardown.
// ---------------------------------------------------------------------------

let instance: RestoreManager | null = null;

export function getRestoreManager(): RestoreManager {
  if (!instance) {
    instance = new RestoreManager({
      onCaptured: (event) => emitEvent("onAgentEditCaptured", event),
    });
  }
  return instance;
}

export function resetRestoreManager(): void {
  instance = null;
}
