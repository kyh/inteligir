// What a pasted or photographed file is called in its folder. The server names a paste here and
// the phone a photo, so both step past a taken name the same way.

import { takenIgnoringCase } from "./doc-file";
import { joinPath } from "./vault-path";

const UNSAFE_RUN = /[^\p{L}\p{N}._ -]+/gu;

// a leading dot would hide the file; a hyphen or a space at either edge is a replaced run's leftover
const LOOSE_EDGES = /^[.\s-]+|[.\s-]+$/gu;

const FALLBACK_STEM = "asset";

// where an attachment lands unless the vault chose another place; the phone, which never reads
// that choice, always lands its photos here
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

// the same, past every path held
export const freeAssetPath = (
  dir: string,
  baseName: string,
  takenPaths: Iterable<string>,
): string => freeAssetPathWhere(dir, baseName, takenIgnoringCase(takenPaths));
