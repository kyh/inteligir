import type { Stats } from "node:fs";
import { lstat } from "node:fs/promises";

// "unknown" names no paths (a pass whose rewrite no diff could name): a consumer must re-diff.
export type VaultFilesChange = { kind: "paths"; paths: readonly string[] } | { kind: "unknown" };

// what an lstat of the entry answers right after a mutation. a watcher event whose lstat still
// answers it is that mutation's echo; a foreign write behind it answers something else.
export type EntryFingerprint =
  | { kind: "absent" }
  | { kind: "present"; ino: number; size: number; mtimeMs: number };

export interface VaultMutation {
  path: string;
  fingerprint: EntryFingerprint;
}

export const ABSENT_ENTRY: EntryFingerprint = { kind: "absent" };

export const fingerprintOf = (stats: Stats): EntryFingerprint => ({
  ino: stats.ino,
  kind: "present",
  mtimeMs: stats.mtimeMs,
  size: stats.size,
});

// any refusal reads as absent, on the recording side and the checking side alike.
export const entryFingerprintAt = async (absPath: string): Promise<EntryFingerprint> => {
  try {
    return fingerprintOf(await lstat(absPath));
  } catch {
    return ABSENT_ENTRY;
  }
};

export const sameEntryFingerprint = (a: EntryFingerprint, b: EntryFingerprint): boolean => {
  if (a.kind === "absent" || b.kind === "absent") {
    return a.kind === b.kind;
  }
  return a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs;
};
