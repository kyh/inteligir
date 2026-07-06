import type { Hash, VaultFile, VaultPath } from "./vault-file";

// ---------------------------------------------------------------------------
// Manifests — a vault's file set at a point in time, from two vantage points:
// the coordinator (`VaultManifest`, versioned) and the local device
// (`LocalManifest`, unversioned).
//
// Scope: manifests list VAULT FILES ONLY. Derived state — the knowledge index
// (link graph, backlinks, lexical search) and all AI/editor state — is rebuilt
// per device and is NEVER part of a manifest and NEVER synced.
// ---------------------------------------------------------------------------

/**
 * A coordinator snapshot: every file in a vault with its assigned version, at a
 * point in time. `generation` is a vault-wide monotonic counter bumped on every
 * accepted mutation, so a client can cheaply tell "nothing changed since the
 * generation I last synced" without diffing the whole file list.
 */
export type VaultManifest = {
  readonly vaultId: string;
  readonly generation: number;
  readonly files: readonly VaultFile[];
};

/**
 * A file as it exists on the local device right now. Unlike a `VaultFile` it
 * carries no version of its own — only the coordinator mints versions. Its
 * position in the version order is the version of the same path in the `base`
 * (last-synced) manifest handed to `reconcile`.
 */
export type LocalFile = {
  readonly path: VaultPath;
  readonly contentHash: Hash;
  readonly size: number;
};

/** The local device's current view of its vault. */
export type LocalManifest = {
  readonly vaultId: string;
  readonly files: readonly LocalFile[];
};
