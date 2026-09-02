import { normalizeVaultPath, VaultPathError } from "@repo/notes/knowledge/vault-path";
import { resolve } from "node:path";
import { pathContains } from "../path-containment";

// normalizeVaultPath is the real gate; containment on the resolved result is the belt.
export function resolveVaultPath(root: string, raw: string) {
  const relPath = normalizeVaultPath(raw);
  const absPath = resolve(root, relPath);
  if (!pathContains(root, absPath)) {
    throw new VaultPathError("path escapes the vault root");
  }
  return { relPath, absPath };
}
