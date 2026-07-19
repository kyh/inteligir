// ---------------------------------------------------------------------------
// Pure posix-style path helpers for vault-relative paths. Core is isomorphic
// (no node:path), and vault paths are always `/`-separated relative strings
// (VaultEntry.path), so a tiny purpose-built set beats a node polyfill.
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
