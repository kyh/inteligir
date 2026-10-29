// .mdx excluded: the Plate markdown pipeline doesn't round-trip MDX.
const MARKDOWN_RE = /\.(?:md|markdown)$/iu;

export const isMarkdownPath = (path: string): boolean => MARKDOWN_RE.test(path);

// `loading` carries the intent path so highlights key off it before content lands;
// it is also the transient during a rename carry or a vanish.
export type OpenDoc =
  | { kind: "none" }
  | { kind: "loading"; path: string }
  | { kind: "non-markdown"; path: string }
  | { kind: "markdown"; path: string };

export const deriveOpenDoc = (args: {
  openPath: string | null;
  loadedPath: string | null;
}): OpenDoc => {
  const { openPath, loadedPath } = args;
  if (openPath === null) {
    return { kind: "none" };
  }
  if (loadedPath === null) {
    return { kind: "loading", path: openPath };
  }
  return isMarkdownPath(loadedPath)
    ? { kind: "markdown", path: loadedPath }
    : { kind: "non-markdown", path: loadedPath };
};

export const openDocPath = (doc: OpenDoc): string | null => (doc.kind === "none" ? null : doc.path);
