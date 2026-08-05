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
//   - "delegation" / "routine": the owning manager captures the target file's
//     resolved bytes at run START (id = the delegation id / run id) and never
//     fires the toast notifier — their undo surfaces (the dock's "Restore
//     original", Settings → Routines "Restore") land in restoreRunSnapshot()
//     behind the manager's own run-state guard.
// The bytes live in the SnapshotStore (snapshot-store.ts) either way — one
// store, one retention sweep, one rename remap.
//
// A NEW-FILE chat `write` (nothing existed to copy) is recorded as kind
// "create": undo means deleting the file, routed to the OS trash like every
// other user-initiated delete (CLAUDE.md § Decisions). An `edit` on a missing
// file captures nothing — pi's edit tool ENOENTs, so there is no write to
// protect. Any other read failure THROWS: the gate lets it propagate and pi
// blocks the call (fail-closed — an AI edit with no undo point must never
// happen). The run-origin variants throw on any capture failure for the same
// reason: the owning manager aborts the run rather than dispatch an agent
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
    if (request.origin !== "chat") {
      // Bytes provided by the caller (the exact content the run was resolved
      // against); null = target absent → "create", whose restore is a delete.
      // A store failure throws through to abort the run.
      this.snapshots.capture(
        {
          id: request.id,
          origin: request.origin,
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
        await this.applyRestore(snapshot.kind, snapshot.content, snapshot.path);
      } catch (err) {
        failures.push(`Couldn't restore ${snapshot.path}: ${toErrorMessage(err)}`);
      }
    }
    return failures.length === 0 ? { ok: true } : { ok: false, error: failures.join(" ") };
  }

  /** Undo the NEWEST chat capture for one note — the agent's own undo
   * capability (@repo/bridge/agent-grants, destructive-confirmed). Keyed by
   * path rather than id: a model has no capture ids, and the renderer's
   * per-turn grouping (first capture per path) is a UI notion the agent has no
   * turn boundary for. Newest, so "undo your last edit to this note" means
   * exactly that; an older state is the user's own undo toast to reach. */
  async restoreLatestChatEdit(path: string): Promise<RestoreAgentEditsResult> {
    const id = this.snapshots.latestId("chat", path);
    if (id === null) {
      return { ok: false, error: `No saved copy of ${path} from this conversation.` };
    }
    return this.restoreChatEdits([id]);
  }

  /** The byte-restore shared by both undo surfaces: a `create` snapshot undoes
   * by trashing the created file (recoverably — OS trash, already-gone counts
   * as done); an `edit` snapshot writes the pre-write bytes back, recreating
   * the file if it was deleted since. Byte-equality IS hash-equality here —
   * the snapshot's recorded hash was already verified against its content in
   * read() — so a matching file is a no-op success (no write, no watcher
   * churn). */
  private async applyRestore(
    kind: "create" | "edit",
    content: string,
    targetPath: string,
  ): Promise<void> {
    if (kind === "create") {
      await this.trashVault(targetPath);
      return;
    }
    let current: string | null;
    try {
      current = this.readVault(targetPath);
    } catch {
      current = null; // deleted (or unreadable) since — the write below recreates it
    }
    if (current !== content) {
      this.writeVault(targetPath, content);
    }
  }

  /** Write a run's pre-run bytes back to `targetPath` — the byte-level half
   * of the dock's "Restore original" (delegation) and Settings → Routines
   * "Restore" (routine). The caller (the origin's manager) owns the record
   * side: it refuses while the run is queued/running, passes the CURRENT
   * target path (its rename remap keeps it pointing at the moved file), then
   * records `restoredAt` on success. An `edit` snapshot writes back through
   * the vault's atomic write (the watcher refreshes editors naturally) and
   * recreates the file if it was deleted since; when the file already matches
   * the snapshot this is a no-op success (no write, no watcher churn). A
   * `create` snapshot (the target didn't exist pre-run) undoes by moving the
   * created file to the OS trash — already-gone counts as done, mirroring
   * the chat create-undo. */
  async restoreRunSnapshot(
    origin: "delegation" | "routine",
    id: string,
    targetPath: string,
  ): Promise<RestoreSnapshotResult> {
    const snapshot = this.snapshots.read(id);
    if (!snapshot.ok) return { ok: false, error: snapshot.error };
    if (snapshot.origin !== origin) {
      // Unreachable through the UI (each surface's ids key its own origin's
      // snapshots), kept for symmetry with the chat-side origin guard.
      return { ok: false, error: `Not a ${origin} edit.` };
    }
    try {
      await this.applyRestore(snapshot.kind, snapshot.content, targetPath);
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
