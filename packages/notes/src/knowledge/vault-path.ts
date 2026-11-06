// A folder tree's paths without node:path, since this runs in client bundles and the Worker: the
// import's and the export's plans, a zip's reader and the links' resolver join, split and compare
// an entry's place in the tree a markdown folder is by these.

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

// A Mac's filesystem is case- and normalization-insensitive: two paths with one key are one file
// there, so every writer that steps past a taken name, and the Worker that refuses a collision,
// compares by it.
export const vaultCollisionKey = (path: string): string => path.normalize("NFC").toLowerCase();
