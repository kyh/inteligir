// No node:path: this runs in client bundles. The grammar is spelled once because
// the wire contract, the server and the index all refuse by it.

// `..` past the root is kept (`normalizePath("../x") === "../x"`) so a caller can detect the escape
export const normalizePath = (p: string): string => {
  const out: string[] = [];
  for (const segment of p.split("/")) {
    if (segment === "" || segment === ".") {
      continue;
    }
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
};

export const dirnamePath = (p: string): string => {
  const idx = p.lastIndexOf("/");
  return idx === -1 ? "" : p.slice(0, idx);
};

export const basenamePath = (p: string): string => {
  const idx = p.lastIndexOf("/");
  return idx === -1 ? p : p.slice(idx + 1);
};

export const extnamePath = (p: string): string => {
  const base = basenamePath(p);
  const idx = base.lastIndexOf(".");
  return idx <= 0 ? "" : base.slice(idx);
};

export const joinPath = (dir: string, rel: string): string =>
  normalizePath(dir === "" ? rel : `${dir}/${rel}`);

export const relativePath = (fromDir: string, toPath: string): string => {
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
    common += 1;
  }
  const ups = fromParts.length - common;
  const parts = [...Array.from({ length: ups }, () => ".."), ...toParts.slice(common)];
  return parts.join("/");
};

// atomic writes stage under this; the listing, the watcher and git (.git/info/exclude) all hide it
export const VAULT_TMP_PREFIX = ".inteligir-tmp-";

const MAX_VAULT_PATH_LENGTH = 1024;

export class VaultPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VaultPathError";
  }
}

export type VaultPathParse =
  | { readonly ok: true; readonly path: string }
  | { readonly ok: false; readonly message: string };

// `\` is refused rather than treated as a separator, so a path never names different files on different platforms
export const parseVaultPath = (raw: string): VaultPathParse => {
  if (raw.length === 0 || raw.length > MAX_VAULT_PATH_LENGTH) {
    return { message: "path must be a non-empty string of reasonable length", ok: false };
  }
  if (raw.includes("\0")) {
    return { message: "path must not contain null bytes", ok: false };
  }
  if (raw.includes("\\")) {
    return { message: "path must use / separators", ok: false };
  }
  if (raw.startsWith("/")) {
    return { message: "path must be relative to the vault root", ok: false };
  }
  const segments = raw.split("/").filter((segment) => segment.length > 0);
  if (segments.length === 0) {
    return { message: "path must name an entry inside the vault", ok: false };
  }
  for (const segment of segments) {
    if (segment === "." || segment === "..") {
      return { message: "path must not contain . or .. segments", ok: false };
    }
    if (segment.toLowerCase() === ".git") {
      return { message: "path must not reach into .git", ok: false };
    }
    if (segment.startsWith(VAULT_TMP_PREFIX)) {
      return { message: "path must not name a staging file", ok: false };
    }
  }
  return { ok: true, path: segments.join("/") };
};

export const normalizeVaultPath = (raw: string): string => {
  const parsed = parseVaultPath(raw);
  if (!parsed.ok) {
    throw new VaultPathError(parsed.message);
  }
  return parsed.path;
};

export const isIgnoredEntryName = (name: string): boolean =>
  name.toLowerCase() === ".git" || name.startsWith(VAULT_TMP_PREFIX);
