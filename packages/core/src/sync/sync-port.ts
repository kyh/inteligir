import type { VaultManifest } from "./manifest";
import type { VaultFile, VaultPath } from "./vault-file";

// ---------------------------------------------------------------------------
// SyncPort — the transport the coordinator implements and every client calls.
//
// Deliberately tiny + I/O-shaped so one interface sits over HTTP, a WebSocket,
// or an in-process fake in tests. All concurrency is OPTIMISTIC: a write carries
// the version the caller last saw and comes back as a typed result — a conflict
// is a value, never a thrown exception — so callers must handle it, not catch
// it.
// ---------------------------------------------------------------------------

/** Result of reading a file from the coordinator. */
export type GetResult =
  | { readonly ok: true; readonly file: VaultFile; readonly content: string }
  | { readonly ok: false; readonly reason: "not-found" };

/**
 * Result of an optimistic write. On `version-conflict` the coordinator returns
 * the file it currently holds so the caller can re-reconcile against it rather
 * than guess.
 */
export type PutResult =
  | { readonly ok: true; readonly file: VaultFile }
  | { readonly ok: false; readonly reason: "version-conflict"; readonly current: VaultFile };

/** Result of an optimistic delete. */
export type DeleteResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: "not-found" }
  | { readonly ok: false; readonly reason: "version-conflict"; readonly current: VaultFile };

/** A change another client committed to the coordinator, pushed to subscribers. */
export type VaultChange =
  | { readonly kind: "upserted"; readonly file: VaultFile }
  | { readonly kind: "deleted"; readonly path: VaultPath };

/** Tear down a `subscribe` registration. */
export type Unsubscribe = () => void;

/**
 * The vault-sync transport. Implemented by the backend (a Cloudflare Durable
 * Object, later), called by clients (desktop, mobile). Content is markdown text
 * (`string`); binary vault files (images, pdfs) are out of scope for now — a
 * follow-up would widen `content` to bytes.
 */
export interface SyncPort {
  /** The coordinator's current snapshot of the vault. */
  listManifest(): Promise<VaultManifest>;

  /** Read one file's content + current version. */
  getFile(path: VaultPath): Promise<GetResult>;

  /**
   * Create or overwrite a file. Succeeds only if the coordinator's current
   * version equals `expectedBaseVersion` (`ABSENT_VERSION` = "must not exist");
   * otherwise returns `version-conflict` with the current file.
   */
  putFile(path: VaultPath, content: string, expectedBaseVersion: number): Promise<PutResult>;

  /** Delete a file, guarded by the same optimistic-concurrency token. */
  deleteFile(path: VaultPath, expectedBaseVersion: number): Promise<DeleteResult>;

  /** Subscribe to changes other clients commit; returns an unsubscribe fn. */
  subscribe(onChange: (change: VaultChange) => void): Unsubscribe;
}
