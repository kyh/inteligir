import { basenamePath, extnamePath } from "./folder-path";

const DOC_EXTENSIONS = new Set([".md", ".markdown", ".mdx", ".txt"]);

export const isDocPath = (path: string): boolean =>
  DOC_EXTENSIONS.has(extnamePath(path).toLowerCase());

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

// What an import makes an item of is what the user wrote. A dot-entry (an app's own, like
// `.obsidian/`) is nobody's to open here.
export const isDotEntryPath = (path: string): boolean =>
  path.split("/").some((segment) => segment.startsWith("."));

const OS_LITTER_NAMES = new Set([".ds_store", "__macosx", "desktop.ini", "thumbs.db"]);

// what an operating system leaves in any folder it shows or zips, a Mac's `._` twin of a file
// among it: nobody's item wherever it lies, even in a folder that takes a dot-entry as a file
export const isOsLitterPath = (path: string): boolean =>
  path
    .split("/")
    .some((segment) => segment.startsWith("._") || OS_LITTER_NAMES.has(segment.toLowerCase()));
