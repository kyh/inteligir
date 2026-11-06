// What a file is called in its folder when an export writes the library out as a markdown folder:
// its own name, less what a filename should not carry, stepped past a name already taken.

import { joinPath } from "./folder-path";

const UNSAFE_RUN = /[^\p{L}\p{N}._ -]+/gu;

// a leading dot would hide the file; a hyphen or a space at either edge is a replaced run's leftover
const LOOSE_EDGES = /^[.\s-]+|[.\s-]+$/gu;

const FALLBACK_STEM = "asset";

// where an export writes a file no item names a place for
export const DEFAULT_ATTACHMENTS_FOLDER = "assets";

// the first of `stem.ext`, `stem-2.ext`, `stem-3.ext`… under `dir` that `isTaken` refuses, which
// answers ignoring case itself, since a case-insensitive disk answers `Shot.png` for `shot.png`.
// The extension is lowercased and the stem kept as written, less what a filename should not carry.
export const freeAssetPathWhere = (
  dir: string,
  baseName: string,
  isTaken: (path: string) => boolean,
): string => {
  const dot = baseName.lastIndexOf(".");
  const extension = dot > 0 ? baseName.slice(dot).toLowerCase() : "";
  const stem = (dot > 0 ? baseName.slice(0, dot) : baseName)
    .replaceAll(UNSAFE_RUN, "-")
    .replaceAll(LOOSE_EDGES, "");
  const safeStem = stem === "" ? FALLBACK_STEM : stem;
  for (let n = 1; ; n += 1) {
    const name = n === 1 ? `${safeStem}${extension}` : `${safeStem}-${String(n)}${extension}`;
    const path = joinPath(dir, name);
    if (!isTaken(path)) {
      return path;
    }
  }
};
