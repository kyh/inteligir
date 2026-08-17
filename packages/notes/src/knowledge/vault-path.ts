// ---------------------------------------------------------------------------
// Pure posix-style path helpers for vault-relative paths, and THE grammar a
// caller-supplied one must satisfy. Core is isomorphic (no node:path), and
// vault paths are always `/`-separated relative strings (VaultEntry.path), so
// a tiny purpose-built set beats a node polyfill.
//
// The grammar lives here rather than beside the filesystem it guards because
// three surfaces state it: the wire contract refuses a bad path as a request
// value, the server refuses one before any fs call, and the index refuses one
// before a query. A second copy anywhere is a boundary that admits what
// another rejects. Parser-free by construction — validating a path must never
// drag remark into a client bundle.
// ---------------------------------------------------------------------------

/** Normalize a vault-relative path: `/`-separators, `.` dropped, `..` resolved.
 * `..` segments that climb past the vault root are KEPT (leading `..`) so a
 * caller can detect the escape — `normalizePath("../x") === "../x"`. A leading
 * `/` is treated as vault-root-relative and stripped. */
export function normalizePath(p: string): string {
  const out: string[] = [];
  for (const segment of p.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      const last = out.at(-1);
      if (last !== undefined && last !== "..") {
        out.pop();
        continue;
      }
    }
    out.push(segment);
  }
  return out.join("/");
}

/** Directory part of a vault path (`""` for a root-level file). */
export function dirnamePath(p: string): string {
  const idx = p.lastIndexOf("/");
  return idx === -1 ? "" : p.slice(0, idx);
}

/** Final segment of a vault path. */
export function basenamePath(p: string): string {
  const idx = p.lastIndexOf("/");
  return idx === -1 ? p : p.slice(idx + 1);
}

/** Extension of the final segment including the dot (`".md"`), or `""`. */
export function extnamePath(p: string): string {
  const base = basenamePath(p);
  const idx = base.lastIndexOf(".");
  return idx <= 0 ? "" : base.slice(idx);
}

/** Join a directory and a relative path, normalized. */
export function joinPath(dir: string, rel: string): string {
  return normalizePath(dir === "" ? rel : `${dir}/${rel}`);
}

/** Relative path from `fromDir` (a vault directory, `""` = root) to `toPath`
 * (a vault file path) — what a standard markdown link between the two needs. */
export function relativePath(fromDir: string, toPath: string): string {
  const from = normalizePath(fromDir);
  const to = normalizePath(toPath);
  const fromParts = from === "" ? [] : from.split("/");
  const toParts = to.split("/");
  let common = 0;
  while (
    common < fromParts.length &&
    common < toParts.length - 1 &&
    fromParts[common] === toParts[common]
  ) {
    common++;
  }
  const ups = fromParts.length - common;
  const parts = [...Array.from({ length: ups }, () => ".."), ...toParts.slice(common)];
  return parts.join("/");
}

/** Atomic writes stage under this prefix; staged files are invisible to the
 *  listing, the watcher and git (swept at boot, excluded via .git/info/exclude). */
export const VAULT_TMP_PREFIX = ".inteligir-tmp-";

const MAX_VAULT_PATH_LENGTH = 1024;

export class VaultPathError extends Error {}

export type VaultPathParse =
  | { readonly ok: true; readonly path: string }
  | { readonly ok: false; readonly message: string };

/**
 * THE vault-path grammar, as a value rather than a throw so a schema can carry
 * it: relative, `/`-separated, no traversal, no reach into `.git` or the
 * staging prefix. `/` is the only accepted separator — a `\` is refused rather
 * than treated as one, so a path never means different files on different
 * platforms. On success the path comes back normalized (empty segments and a
 * trailing slash dropped).
 */
export function parseVaultPath(raw: string): VaultPathParse {
  if (raw.length === 0 || raw.length > MAX_VAULT_PATH_LENGTH) {
    return { ok: false, message: "path must be a non-empty string of reasonable length" };
  }
  if (raw.includes("\0")) {
    return { ok: false, message: "path must not contain null bytes" };
  }
  if (raw.includes("\\")) {
    return { ok: false, message: "path must use / separators" };
  }
  if (raw.startsWith("/")) {
    return { ok: false, message: "path must be relative to the vault root" };
  }
  const segments = raw.split("/").filter((segment) => segment.length > 0);
  if (segments.length === 0) {
    return { ok: false, message: "path must name an entry inside the vault" };
  }
  for (const segment of segments) {
    if (segment === "." || segment === "..") {
      return { ok: false, message: "path must not contain . or .. segments" };
    }
    if (segment.toLowerCase() === ".git") {
      return { ok: false, message: "path must not reach into .git" };
    }
    if (segment.startsWith(VAULT_TMP_PREFIX)) {
      return { ok: false, message: "path must not name a staging file" };
    }
  }
  return { ok: true, path: segments.join("/") };
}

/** {@link parseVaultPath} for callers with nowhere to put a refusal value —
 *  the filesystem gate, whose every caller treats a bad path as an exception. */
export function normalizeVaultPath(raw: string): string {
  const parsed = parseVaultPath(raw);
  if (!parsed.ok) {
    throw new VaultPathError(parsed.message);
  }
  return parsed.path;
}

/** Directory entries the vault never exposes: repo metadata and staging files. */
export function isIgnoredEntryName(name: string): boolean {
  return name.toLowerCase() === ".git" || name.startsWith(VAULT_TMP_PREFIX);
}
