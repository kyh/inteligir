import { basenamePath, extnamePath } from "./folder-path";

const DOC_EXTENSIONS = new Set([".md", ".markdown", ".mdx", ".txt"]);

export const isDocPath = (path: string) => DOC_EXTENSIONS.has(extnamePath(path).toLowerCase());

export const docExtension = (path: string) => (isDocPath(path) ? extnamePath(path) : "");

export const docStem = (path: string) => {
  const name = basenamePath(path);

  return name.slice(0, name.length - docExtension(path).length);
};

export const IMPLIED_LINK_EXTENSION = ".md";

const impliedLinkExtension = (path: string) => {
  const ext = extnamePath(path);

  return ext.toLowerCase() === IMPLIED_LINK_EXTENSION ? ext : "";
};

export const wikiLinkPath = (path: string) =>
  path.slice(0, path.length - impliedLinkExtension(path).length);

export const wikiLinkName = (path: string) => wikiLinkPath(basenamePath(path));

export const isDotEntryPath = (path: string) =>
  path.split("/").some((segment) => segment.startsWith("."));

const OS_LITTER_NAMES = new Set([".ds_store", "__macosx", "desktop.ini", "thumbs.db"]);

export const isOsLitterPath = (path: string) =>
  path
    .split("/")
    .some((segment) => segment.startsWith("._") || OS_LITTER_NAMES.has(segment.toLowerCase()));
