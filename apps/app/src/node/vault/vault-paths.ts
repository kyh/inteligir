// The filesystem half of vault-path handling. The GRAMMAR — what a
// caller-supplied path may say — is `@repo/notes/knowledge/vault-path`, shared
// with the wire contract that refuses a bad one before it arrives; what is
// left here is the part that needs a real machine's paths.

import { normalizeVaultPath, VaultPathError } from "@repo/notes/knowledge/vault-path";
import { resolve } from "node:path";
import { pathContains } from "../path-containment";

/**
 * Resolve a normalized vault path against the root, re-asserting containment
 * on the RESOLVED result — the normalize pass is the real gate, this is the
 * belt to its braces.
 */
export function resolveVaultPath(root: string, raw: string): { relPath: string; absPath: string } {
  const relPath = normalizeVaultPath(raw);
  const absPath = resolve(root, relPath);
  if (!pathContains(root, absPath)) {
    throw new VaultPathError("path escapes the vault root");
  }
  return { relPath, absPath };
}
