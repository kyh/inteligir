// Vault-relative path validation. Every route and service call funnels its
// caller-supplied path through here BEFORE any filesystem access, so a
// traversal attempt or a reach into .git is refused as a value, not caught as
// an fs error.

import { resolve, sep } from "node:path";

/** Atomic writes stage under this prefix; staged files are invisible to the
 *  listing, the watcher and git (swept at boot, excluded via .git/info/exclude). */
export const VAULT_TMP_PREFIX = ".inteligir-tmp-";

const MAX_PATH_LENGTH = 1024;

export class VaultPathError extends Error {}

/**
 * Normalize a caller-supplied vault path to a clean POSIX-relative form, or
 * throw {@link VaultPathError}. `/` is the only accepted separator — a `\` is
 * refused rather than treated as one, so a path never means different files on
 * different platforms.
 */
export function normalizeVaultPath(raw: string): string {
  if (raw.length === 0 || raw.length > MAX_PATH_LENGTH) {
    throw new VaultPathError("path must be a non-empty string of reasonable length");
  }
  if (raw.includes("\0")) {
    throw new VaultPathError("path must not contain null bytes");
  }
  if (raw.includes("\\")) {
    throw new VaultPathError("path must use / separators");
  }
  if (raw.startsWith("/")) {
    throw new VaultPathError("path must be relative to the vault root");
  }
  const segments = raw.split("/").filter((segment) => segment.length > 0);
  if (segments.length === 0) {
    throw new VaultPathError("path must name an entry inside the vault");
  }
  for (const segment of segments) {
    if (segment === "." || segment === "..") {
      throw new VaultPathError("path must not contain . or .. segments");
    }
    if (segment.toLowerCase() === ".git") {
      throw new VaultPathError("path must not reach into .git");
    }
    if (segment.startsWith(VAULT_TMP_PREFIX)) {
      throw new VaultPathError("path must not name a staging file");
    }
  }
  return segments.join("/");
}

/**
 * Resolve a normalized vault path against the root, re-asserting containment
 * on the RESOLVED result — the normalize pass is the real gate, this is the
 * belt to its braces.
 */
export function resolveVaultPath(root: string, raw: string): { relPath: string; absPath: string } {
  const relPath = normalizeVaultPath(raw);
  const absPath = resolve(root, relPath);
  if (absPath !== root && !absPath.startsWith(root + sep)) {
    throw new VaultPathError("path escapes the vault root");
  }
  return { relPath, absPath };
}

/** Directory entries the vault never exposes: repo metadata and staging files. */
export function isIgnoredEntryName(name: string): boolean {
  return name.toLowerCase() === ".git" || name.startsWith(VAULT_TMP_PREFIX);
}
