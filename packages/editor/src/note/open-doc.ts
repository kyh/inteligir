import type { GateReason } from "@repo/editor/note/markdown-gate";

// .mdx excluded: the Plate markdown pipeline doesn't round-trip MDX.
const MARKDOWN_RE = /\.(md|markdown)$/i;

export function isMarkdownPath(path: string): boolean {
  return MARKDOWN_RE.test(path);
}

type MarkdownSurface = { mode: "rich" } | { mode: "raw"; reason: GateReason };

// `loading` carries the intent path so highlights key off it before content lands;
// it is also the transient during a rename carry or a vanish.
export type OpenDoc =
  | { kind: "none" }
  | { kind: "loading"; path: string }
  | { kind: "non-markdown"; path: string }
  | { kind: "markdown"; path: string; surface: MarkdownSurface };

export function deriveOpenDoc(args: {
  openPath: string | null;
  loadedPath: string | null;
  rawReason: GateReason | null;
}): OpenDoc {
  const { openPath, loadedPath, rawReason } = args;
  if (openPath === null) return { kind: "none" };
  if (loadedPath === null) return { kind: "loading", path: openPath };
  if (!isMarkdownPath(loadedPath)) return { kind: "non-markdown", path: loadedPath };
  const surface: MarkdownSurface =
    rawReason === null ? { mode: "rich" } : { mode: "raw", reason: rawReason };
  return {
    kind: "markdown",
    path: loadedPath,
    surface,
  };
}

export function openDocPath(doc: OpenDoc): string | null {
  return doc.kind === "none" ? null : doc.path;
}
