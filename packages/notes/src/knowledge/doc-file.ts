import { basenamePath, extnamePath } from "./vault-path";

const DOC_EXTENSIONS = new Set([".md", ".markdown", ".mdx", ".txt"]);

export const DEFAULT_DOC_EXTENSION = ".md";

export function isDocPath(path: string): boolean {
  return DOC_EXTENSIONS.has(extnamePath(path).toLowerCase());
}

export function docExtension(path: string): string {
  return isDocPath(path) ? extnamePath(path) : "";
}

export function docStem(path: string): string {
  const name = basenamePath(path);
  return name.slice(0, name.length - docExtension(path).length);
}
