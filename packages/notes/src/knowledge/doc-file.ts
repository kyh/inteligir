import { basenamePath, extnamePath, joinPath } from "./folder-path";

const DOC_EXTENSIONS = new Set([".md", ".markdown", ".mdx", ".txt"]);

export const isDocPath = (path: string): boolean =>
  DOC_EXTENSIONS.has(extnamePath(path).toLowerCase());

/** @internal */
export const docExtension = (path: string): string => (isDocPath(path) ? extnamePath(path) : "");

export const docStem = (path: string): string => {
  const name = basenamePath(path);
  return name.slice(0, name.length - docExtension(path).length);
};

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

// What an import makes an item of is what the user wrote. A dot-entry (the annotation store's
// `.inteligir/`, another app's `.obsidian/`, the OS's `.DS_Store`) is nobody's to open here.
export const isDotEntryPath = (path: string): boolean =>
  path.split("/").some((segment) => segment.startsWith("."));

// a free spelling of a name, and which of its spellings it is (1 for the name itself)
export interface FreePath {
  readonly path: string;
  readonly n: number;
}

// The first of `stem`, `stem 2`, `stem 3`… under `dir`, extension kept, that `isTaken` refuses,
// counting from the `from`th, and the count it took, so a writer naming many files alike resumes
// where its last search for that name stopped.
export const freePathFrom = (
  dir: string,
  stem: string,
  extension: string,
  isTaken: (path: string) => boolean,
  from: number,
): FreePath => {
  for (let n = Math.max(1, from); ; n += 1) {
    const path = joinPath(dir, `${n === 1 ? stem : `${stem} ${String(n)}`}${extension}`);
    if (!isTaken(path)) {
      return { n, path };
    }
  }
};

export const freePath = (
  dir: string,
  stem: string,
  extension: string,
  isTaken: (path: string) => boolean,
): string => freePathFrom(dir, stem, extension, isTaken, 1).path;
