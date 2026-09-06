import { isLegacyCommentsSidecarPath } from "../comments/sidecar-schema";
import { basenamePath, extnamePath, joinPath } from "./vault-path";

const DOC_EXTENSIONS = new Set([".md", ".markdown", ".mdx", ".txt"]);

export const DEFAULT_DOC_EXTENSION = ".md";

export function isDocPath(path: string): boolean {
  return DOC_EXTENSIONS.has(extnamePath(path).toLowerCase());
}

export function docExtension(path: string): string {
  return isDocPath(path) ? extnamePath(path) : "";
}

export function docStem(path: string): string {
  const name = basenamePath(path);
  return name.slice(0, name.length - docExtension(path).length);
}

// A listing shows what the user wrote. A comment sidecar is the product's, and a dot-entry
// (another app's `.obsidian/`, the OS's `.DS_Store`) is nobody's to open here; the server's
// listing stays complete because the CLI and the agent read it.
export function isVaultMetadataPath(path: string): boolean {
  return (
    isLegacyCommentsSidecarPath(path) || path.split("/").some((segment) => segment.startsWith("."))
  );
}

// The first of `stem`, `stem 2`, `stem 3`… not taken under `dir`. Lowercased on both sides
// because the disk may be case-insensitive; the server's `ifAbsent` stays the real guard.
export function freeDocPath(dir: string, stem: string, takenPaths: Iterable<string>): string {
  const taken = new Set([...takenPaths].map((path) => path.toLowerCase()));
  for (let n = 1; ; n += 1) {
    const name = `${n === 1 ? stem : `${stem} ${String(n)}`}${DEFAULT_DOC_EXTENSION}`;
    const path = joinPath(dir, name);
    if (!taken.has(path.toLowerCase())) return path;
  }
}
