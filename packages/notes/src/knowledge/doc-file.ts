import { basenamePath, extnamePath } from "./vault-path";

const DOC_EXTENSIONS = new Set([".md", ".markdown", ".mdx", ".txt"]);

export const DEFAULT_DOC_EXTENSION = ".md";

export function isDocPath(path: string): boolean {
  return DOC_EXTENSIONS.has(extnamePath(path).toLowerCase());
}

// narrower than isDocPath on purpose: a caller splicing frontmatter must not write YAML into a .txt
export function isNotePath(path: string): boolean {
  return extnamePath(path).toLowerCase() === DEFAULT_DOC_EXTENSION;
}

export function docExtension(path: string): string {
  return isDocPath(path) ? extnamePath(path) : "";
}

export function docStem(path: string): string {
  const name = basenamePath(path);
  return name.slice(0, name.length - docExtension(path).length);
}
