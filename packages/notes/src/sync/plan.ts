import type { LocalFile } from "./manifest";
import type { Hash, VaultFile, VaultPath } from "./vault-file";

// ---------------------------------------------------------------------------
// SyncPlan — the typed operations `reconcile` produces to converge one vault.
// Each op is self-describing; an executor applies them against a `SyncPort`
// (remote) plus local vault access. Ops within a plan touch disjoint paths, so
// they may be applied in any order.
// ---------------------------------------------------------------------------

/** Which side of the sync a value belongs to / an op acts on. */
export type SyncSide = "local" | "remote";

/**
 * Upload the local file's bytes to the coordinator. Emitted when local is the
 * sole author of a change (or won a conflict). The executor reads the bytes from
 * the local vault at `path` and calls `putFile(path, bytes, expectedBaseVersion)`.
 */
type Push = {
  readonly kind: "push";
  readonly path: VaultPath;
  /** OCC token: the coordinator version this push is based on
   *  (`ABSENT_VERSION` for a create). */
  readonly expectedBaseVersion: number;
  /** The BASE manifest's contentHash for this path (`null` = no base entry) —
   * the merge ladder's key into the local base-blob shadow, should this push
   * lose its OCC race and downgrade to a both-sides-changed resolution. */
  readonly baseHash: Hash | null;
};

/**
 * Download the coordinator's file to the local vault. Emitted when remote is the
 * sole author of a change (or won a conflict). The executor fetches
 * `getFile(file.path)`, writes it locally, and records `file.version` as the new
 * local base version.
 */
type Pull = {
  readonly kind: "pull";
  readonly file: VaultFile;
};

/**
 * Remove a file to mirror a deletion the other side made. `side` says where the
 * removal happens: a remote delete carries the OCC token; a local delete needs
 * none (the local vault is the executor's own disk). Split by side so an illegal
 * "local delete with a version" state can't be represented.
 */
type Delete =
  | { readonly kind: "delete"; readonly side: "local"; readonly path: VaultPath }
  | {
      readonly kind: "delete";
      readonly side: "remote";
      readonly path: VaultPath;
      readonly expectedBaseVersion: number;
    };

/**
 * Both sides changed the same path since the last sync (a true conflict).
 * Last-write-wins keeps ONE side's bytes at `path`; the loser's bytes are
 * preserved beside it under `conflictCopyName(path, <iso>)` so nothing is ever
 * lost. `winner` names the side that stays canonical (see `reconcile`'s
 * tiebreak). The executor copies the LOSER's current bytes to the conflict-copy
 * path, converges `path` to the winner (push if local won, pull if remote won),
 * and syncs the new copy too.
 */
type ConflictCopy = {
  readonly kind: "conflict-copy";
  readonly path: VaultPath;
  readonly winner: SyncSide;
  /** The local file at `path` at reconcile time. */
  readonly local: LocalFile;
  /** The coordinator file at `path` at reconcile time (its version = OCC token). */
  readonly remote: VaultFile;
  /** The BASE manifest's contentHash for this path (`null` = both sides
   * CREATED it — a creation collision) — the merge ladder's key into the
   * local base-blob shadow, tried before the copy is written. */
  readonly baseHash: Hash | null;
};

/** One unit of convergence work. */
export type SyncOp = Push | Pull | Delete | ConflictCopy;

/** The full set of operations to converge local <-> coordinator for one vault. */
export type SyncPlan = {
  readonly ops: readonly SyncOp[];
};
