import {
  isValidHash,
  isValidVaultPath,
  type Hash,
  type VaultFile,
  type VaultPath,
} from "./vault-file";
import { isRecord } from "./guards";

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
 * point in time.
 */
export type VaultManifest = {
  readonly vaultId: string;
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

// ---------------------------------------------------------------------------
// Boundary parsers — never trust a wire payload or a persisted cache. One
// implementation for every consumer that decodes a manifest from `unknown`
// (the HTTP client, a device's persisted base-manifest file, tests).
// ---------------------------------------------------------------------------

function isNonNegativeInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/** Decode one `VaultFile` from untrusted data, or null if malformed. */
export function parseVaultFile(raw: unknown): VaultFile | null {
  if (!isRecord(raw)) return null;
  const { path, contentHash, version, size } = raw;
  // A path is the file's identity AND the argument to a platform write sink;
  // reject anything that could escape the vault root (absolute, `..`, control
  // chars, …) HERE so a hostile/buggy coordinator manifest can never drive a
  // traversal on a client that doesn't re-confine — the mobile sink notably
  // does not. Rejecting nulls the whole manifest (all-or-nothing contract).
  if (typeof path !== "string" || !isValidVaultPath(path)) return null;
  if (typeof contentHash !== "string" || !isValidHash(contentHash)) return null;
  if (!isNonNegativeInt(version) || !isNonNegativeInt(size)) return null;
  return { path, contentHash, version, size };
}

/** Decode a `VaultManifest` from untrusted data, or null if any part is
 * malformed (all-or-nothing — a partial manifest would corrupt a 3-way diff). */
export function parseVaultManifest(raw: unknown): VaultManifest | null {
  if (!isRecord(raw)) return null;
  const { vaultId, files } = raw;
  if (typeof vaultId !== "string" || !Array.isArray(files)) {
    return null;
  }
  const parsed: VaultFile[] = [];
  for (const entry of files) {
    const file = parseVaultFile(entry);
    if (!file) return null;
    parsed.push(file);
  }
  return { vaultId, files: parsed };
}
