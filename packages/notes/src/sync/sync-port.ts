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

/**
 * Result of reading a file from the coordinator. `content` is the file's raw
 * bytes (`Uint8Array`) — UTF-8 for markdown, opaque bytes for images/pdfs.
 */
export type GetResult =
  | { readonly ok: true; readonly file: VaultFile; readonly content: Uint8Array }
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
 * The vault-sync transport. Implemented by the backend (the per-vault
 * Cloudflare Durable Object in apps/cloud), called by clients (desktop,
 * mobile). File content is raw
 * bytes (`Uint8Array`) — UTF-8 for markdown, opaque bytes for images/pdfs — so
 * the one protocol carries text and binary vault files alike. (`Uint8Array` is
 * available in Workers, React Native, the browser, and node; node `Buffer` is
 * deliberately NOT used — it would break this package's purity.)
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
  putFile(path: VaultPath, content: Uint8Array, expectedBaseVersion: number): Promise<PutResult>;

  /** Delete a file, guarded by the same optimistic-concurrency token. */
  deleteFile(path: VaultPath, expectedBaseVersion: number): Promise<DeleteResult>;

  /**
   * Subscribe to changes other clients commit; returns an unsubscribe fn.
   *
   * `onEnd` fires at most once, when the stream terminates for a reason OTHER
   * than the returned unsubscribe (network drop, server close, non-OK
   * response) — it is how a caller distinguishes "I closed this" from "this
   * died", and the SyncEngine's reconnect supervision depends on it. A port
   * over a transport that cannot drop (an in-memory fake) may ignore it, but
   * one that CAN drop and never calls it silently strands its subscriber.
   */
  subscribe(onChange: (change: VaultChange) => void, onEnd?: () => void): Unsubscribe;
}
