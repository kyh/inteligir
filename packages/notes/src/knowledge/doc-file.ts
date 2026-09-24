import { isLegacyCommentsSidecarPath } from "../comments/sidecar-schema";
import { basenamePath, extnamePath, joinPath } from "./vault-path";

const DOC_EXTENSIONS = new Set([".md", ".markdown", ".mdx", ".txt"]);

export const DEFAULT_DOC_EXTENSION = ".md";

export const isDocPath = (path: string): boolean =>
  DOC_EXTENSIONS.has(extnamePath(path).toLowerCase());

export const docExtension = (path: string): string => (isDocPath(path) ? extnamePath(path) : "");

export const docStem = (path: string): string => {
  const name = basenamePath(path);
  return name.slice(0, name.length - docExtension(path).length);
};

// a name typed without a doc extension is a title, whatever dots it holds: `Node.js` is a note
export const withDocExtension = (name: string): string =>
  isDocPath(name) ? name : `${name}${DEFAULT_DOC_EXTENSION}`;

// The one extension a link may leave off, and it is not the doc extensions: `[[todo]]` never
// reaches `todo.txt`, as in Obsidian. A second spelling of this rule is a writer minting a link
// the resolver cannot follow back.
export const IMPLIED_LINK_EXTENSION = ".md";

const impliedLinkExtension = (path: string): string => {
  const ext = extnamePath(path);
  return ext.toLowerCase() === IMPLIED_LINK_EXTENSION ? ext : "";
};

export const wikiLinkPath = (path: string): string =>
  path.slice(0, path.length - impliedLinkExtension(path).length);

// the name a bare `[[name]]` answers to; `docStem` is the title, which hides every doc extension
export const wikiLinkName = (path: string): string => wikiLinkPath(basenamePath(path));

// A listing shows what the user wrote. A comment sidecar is the product's, and a dot-entry
// (another app's `.obsidian/`, the OS's `.DS_Store`) is nobody's to open here; the server's
// listing stays complete because the CLI and the agent read it.
export const isVaultMetadataPath = (path: string): boolean =>
  isLegacyCommentsSidecarPath(path) || path.split("/").some((segment) => segment.startsWith("."));

// The first of `stem`, `stem 2`, `stem 3`… not taken under `dir`. Lowercased on both sides
// because the disk may be case-insensitive; the server's `ifAbsent` stays the real guard.
export const freeDocPath = (dir: string, stem: string, takenPaths: Iterable<string>): string => {
  const taken = new Set([...takenPaths].map((path) => path.toLowerCase()));
  for (let n = 1; ; n += 1) {
    const name = `${n === 1 ? stem : `${stem} ${String(n)}`}${DEFAULT_DOC_EXTENSION}`;
    const path = joinPath(dir, name);
    if (!taken.has(path.toLowerCase())) {
      return path;
    }
  }
};
