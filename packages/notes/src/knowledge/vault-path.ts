// No node:path: this runs in client bundles. The grammar is spelled once because
// the wire contract, the server and the index all refuse by it.

// `..` past the root is kept (`normalizePath("../x") === "../x"`) so a caller can detect the escape
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

export function dirnamePath(p: string): string {
  const idx = p.lastIndexOf("/");
  return idx === -1 ? "" : p.slice(0, idx);
}

export function basenamePath(p: string): string {
  const idx = p.lastIndexOf("/");
  return idx === -1 ? p : p.slice(idx + 1);
}

export function extnamePath(p: string): string {
  const base = basenamePath(p);
  const idx = base.lastIndexOf(".");
  return idx <= 0 ? "" : base.slice(idx);
}

export function joinPath(dir: string, rel: string): string {
  return normalizePath(dir === "" ? rel : `${dir}/${rel}`);
}

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

// atomic writes stage under this; the listing, the watcher and git (.git/info/exclude) all hide it
export const VAULT_TMP_PREFIX = ".inteligir-tmp-";

const MAX_VAULT_PATH_LENGTH = 1024;

export class VaultPathError extends Error {}

export type VaultPathParse =
  | { readonly ok: true; readonly path: string }
  | { readonly ok: false; readonly message: string };

// `\` is refused rather than treated as a separator, so a path never names different files on different platforms
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

export function normalizeVaultPath(raw: string): string {
  const parsed = parseVaultPath(raw);
  if (!parsed.ok) {
    throw new VaultPathError(parsed.message);
  }
  return parsed.path;
}

export function isIgnoredEntryName(name: string): boolean {
  return name.toLowerCase() === ".git" || name.startsWith(VAULT_TMP_PREFIX);
}

// a real, synced directory the file tree may show, but the knowledge layer must never index it,
// or every trashed note keeps resolving links and haunting search
export const VAULT_TRASH_DIR = "Trash";

// case-sensitive: the trash is app-minted with this spelling, and a user's own `trash/` folder is their content
export function isTrashedPath(path: string): boolean {
  return path === VAULT_TRASH_DIR || path.startsWith(`${VAULT_TRASH_DIR}/`);
}
