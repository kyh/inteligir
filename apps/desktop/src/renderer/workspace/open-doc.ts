// OpenDoc — the open document modeled as ONE discriminated union, derived per
// render by the VaultProvider (deriveOpenDoc below). It replaces the six
// correlated flat view fields the context used to expose (openPath /
// openNoteIsPrivate / isMarkdownOpen / richAvailable / rawReason / mode), so
// the illegal combinations those allowed — rich mode on a non-markdown file, a
// gate reason without a markdown note, a private mark with nothing open — are
// unrepresentable. Consumers switch on `openDoc.kind`.

import { notePrivacy } from "@repo/core/markdown/frontmatter";

import type { GateReason } from "@renderer/editor/markdown/markdown-doc";

// Files the rich (Plate) editor can render. `.mdx` is excluded — the Plate
// markdown pipeline doesn't round-trip MDX.
const MARKDOWN_RE = /\.(md|markdown)$/i;

/** Whether `path` is a markdown doc the rich editor can render. */
export function isMarkdownPath(path: string): boolean {
  return MARKDOWN_RE.test(path);
}

/**
 * The EFFECTIVE editing surface of an open markdown note:
 * - `rich`: the Plate editor is showing — rich is available by construction.
 * - `raw`: the byte-exact textarea is showing. `reason === null` means the
 *   user chose Raw on a rich-capable note (the header toggle); a non-null
 *   reason means the note is gated to Raw (parse error / out-of-vocabulary
 *   construct / round-trip content loss — the header's Raw badge tooltip).
 *
 * The user's underlying raw/rich pick stays provider state (`setMode`), NOT
 * part of this union: a mid-session gate flip keeps the pick, so a note that
 * recovers (an external edit removed the unrepresentable construct) pops back
 * to the surface the user chose — consumers only ever see the effective one.
 */
type MarkdownSurface = { mode: "rich" } | { mode: "raw"; reason: GateReason | null };

/**
 * The open document:
 * - `none`: no document open.
 * - `loading`: a document is open but its runtime hasn't loaded content yet —
 *   also the transient while a rename carries the note over, or while a
 *   vanished file closes. `path` is the INTENT path (sidebar/graph highlights
 *   key off it before content lands).
 * - `non-markdown`: a loaded non-markdown file (`.html` opened as text,
 *   `.txt`, …) — always the raw textarea. The `.html` app-vs-text view stays
 *   the separate `openIsHtml`/`isHtmlApp` pair: it keys off the intent path
 *   and shows before (and regardless of) the text buffer loading.
 * - `markdown`: a loaded markdown note. `isPrivate` is the header's lock
 *   badge — USER-FACING semantics: strictly `private: true` on the LIVE
 *   buffer (unreadable frontmatter shows no lock); the AI paths use their own
 *   fail-closed reads. `surface` is the effective editing surface.
 */
export type OpenDoc =
  | { kind: "none" }
  | { kind: "loading"; path: string }
  | { kind: "non-markdown"; path: string }
  | { kind: "markdown"; path: string; isPrivate: boolean; surface: MarkdownSurface };

/**
 * Derive the OpenDoc for one render — pure over the provider's live values, so
 * the union stays in lockstep with (path, content, analysis) within a single
 * render, the same guarantee the provider's in-render analysis adjustment
 * gives the gate.
 */
export function deriveOpenDoc(args: {
  /** The note the UI intends open (openPathRef's render mirror). */
  openPath: string | null;
  /** The controller's loaded path — null while reading / after a vanish. */
  loadedPath: string | null;
  /** The live content buffer (privacy reads it, not the saved bytes). */
  content: string;
  /** The last SAVED-content gate verdict (analysis lags typing on purpose). */
  rawReason: GateReason | null;
  /** The user's per-open raw/rich pick (honored only when rich is available). */
  chosenMode: "raw" | "rich";
}): OpenDoc {
  const { openPath, loadedPath, content, rawReason, chosenMode } = args;
  if (openPath === null) return { kind: "none" };
  if (loadedPath === null) return { kind: "loading", path: openPath };
  if (!isMarkdownPath(loadedPath)) return { kind: "non-markdown", path: loadedPath };
  const surface: MarkdownSurface =
    rawReason === null && chosenMode === "rich"
      ? { mode: "rich" }
      : { mode: "raw", reason: rawReason };
  return {
    kind: "markdown",
    path: loadedPath,
    isPrivate: notePrivacy(content) === "private",
    surface,
  };
}

/** The open document's path, if any (`loading` included — highlights use it). */
export function openDocPath(doc: OpenDoc): string | null {
  return doc.kind === "none" ? null : doc.path;
}

/** Whether Rich editing is available: a markdown note whose saved content
 * passes the vocabulary + round-trip gate. Drives the header's raw/rich
 * toggle. */
export function richAvailable(doc: OpenDoc): boolean {
  return doc.kind === "markdown" && (doc.surface.mode === "rich" || doc.surface.reason === null);
}
