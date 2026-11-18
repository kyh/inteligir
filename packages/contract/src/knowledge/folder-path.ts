export const normalizePath = (p: string) => {
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

export const dirnamePath = (p: string) => {
  const idx = p.lastIndexOf("/");

  return idx === -1 ? "" : p.slice(0, idx);
};

export const basenamePath = (p: string) => {
  const idx = p.lastIndexOf("/");

  return idx === -1 ? p : p.slice(idx + 1);
};

export const extnamePath = (p: string) => {
  const base = basenamePath(p);
  const idx = base.lastIndexOf(".");

  return idx <= 0 ? "" : base.slice(idx);
};

export const joinPath = (dir: string, rel: string) =>
  normalizePath(dir === "" ? rel : `${dir}/${rel}`);

export const relativePath = (fromDir: string, toPath: string) => {
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
