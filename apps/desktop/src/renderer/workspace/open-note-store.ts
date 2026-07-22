// OpenNote store — the HIGH-CADENCE slice of the vault workspace (#470).
//
// The open note's exposed state (editor snapshot, derived OpenDoc, raw/rich
// mode, html-app flags) changes on every keystroke (Raw) / serialize settle
// (Rich) / autosave `saving` flip. Exposing it through the old single
// VaultContext value re-rendered ALL consumers per keystroke; a zustand store
// lets each consumer subscribe to exactly the field it reads
// (`useOpenNote((s) => s.editor.path)`), so typing re-renders only the editor.
//
// Division of labor: the VaultProvider still PRODUCES everything — it owns the
// note runtime (controller + autosave debounce + vanish watcher) and its
// open/rename/delete ordering — and drives this store synchronously through
// the publish* functions below. The store owns EXPOSURE plus the derivations
// that were previously computed in the provider's render (gate analysis,
// deriveOpenDoc). Publishing is synchronous with the controller's emission so
// a controlled textarea's value updates in the same event flush as the
// keystroke (an effect-time mirror would let React "restore" the input first).

import { create } from "zustand";

import { toast } from "@repo/ui/components/sonner";

import {
  type GateReason,
  analyzeMarkdown,
  describeGateReason,
  gateReasonFor,
} from "@renderer/editor/markdown/markdown-doc";
import type { VaultEditorState } from "@renderer/editor/vault-editor";
import { type OpenDoc, deriveOpenDoc, isMarkdownPath } from "@renderer/workspace/open-doc";

const HTML_RE = /\.html$/i;

/** The `editor` snapshot exposed while no note is open. */
const NO_NOTE_STATE: VaultEditorState = {
  root: "",
  path: null,
  content: "",
  dirty: false,
  saving: false,
};

/** The last SAVED-content gate verdict, keyed to the (path, content) it was
 * computed for — analysis lags typing on purpose (one pass per saved change,
 * not per keystroke). */
type Analyzed = {
  rawReason: GateReason | null;
  content: string;
  path: string | null;
};

export type OpenNoteState = {
  /** The note the UI intends open (the provider's openPathRef, mirrored). */
  openPath: string | null;
  /** Live editor session state of the open note (file, content, dirty,
   * saving). `NO_NOTE_STATE` when no note is open. */
  editor: VaultEditorState;
  /** Gate verdict for the last analyzed saved content (see Analyzed). */
  analyzed: Analyzed;
  /** The user's raw/rich pick for the open note (honored only while rich is
   * available — deriveOpenDoc exposes the EFFECTIVE surface). */
  mode: "raw" | "rich";
  /** Per-open view choice for `.html` files: raw text (true) vs. app. */
  htmlAsText: boolean;
  /** The open document as ONE discriminated union — derived in lockstep with
   * (openPath, editor, analysis, mode) inside every store update, so it can
   * never disagree with the values it came from. */
  openDoc: OpenDoc;
  /** Whether the open file is a vault `.html` file (renderable as an app). */
  openIsHtml: boolean;
  /** Whether to show the open `.html` as a sandboxed app (vs. raw text). */
  isHtmlApp: boolean;
};

const INITIAL_ANALYZED: Analyzed = { rawReason: null, content: "", path: null };

const INITIAL_STATE: OpenNoteState = {
  openPath: null,
  editor: NO_NOTE_STATE,
  analyzed: INITIAL_ANALYZED,
  mode: "raw",
  htmlAsText: false,
  openDoc: { kind: "none" },
  openIsHtml: false,
  isHtmlApp: false,
};

/** Subscribe to a slice of the open-note state: `useOpenNote((s) => s.mode)`.
 * A consumer re-renders only when ITS selected value changes — the seam that
 * keeps a keystroke from re-rendering the whole app. */
export const useOpenNote = create<OpenNoteState>(() => INITIAL_STATE);

/** Imperative live read for action-time consumers (e.g. the palette's
 * private-toggle reads `editor.content` at click time instead of subscribing
 * to every keystroke). Always the CURRENT value — never capture the result
 * across awaits. */
export function openNoteState(): OpenNoteState {
  return useOpenNote.getState();
}

/** Merge a partial update and recompute the derived fields in the same set,
 * keeping `openDoc` referentially stable when none of its inputs changed
 * (the old provider useMemo's contract). */
function apply(
  partial: Partial<Pick<OpenNoteState, "openPath" | "editor" | "analyzed" | "mode" | "htmlAsText">>,
): void {
  useOpenNote.setState((s) => {
    const merged = { ...s, ...partial };
    const sameDocInputs =
      merged.openPath === s.openPath &&
      merged.editor.path === s.editor.path &&
      merged.editor.content === s.editor.content &&
      merged.analyzed.rawReason === s.analyzed.rawReason &&
      merged.mode === s.mode;
    merged.openDoc = sameDocInputs
      ? s.openDoc
      : deriveOpenDoc({
          openPath: merged.openPath,
          loadedPath: merged.editor.path,
          content: merged.editor.content,
          rawReason: merged.analyzed.rawReason,
          chosenMode: merged.mode,
        });
    merged.openIsHtml = merged.openPath !== null && HTML_RE.test(merged.openPath);
    merged.isHtmlApp = merged.openIsHtml && !merged.htmlAsText;
    return merged;
  });
}

// Gate policy: classify SAVED bytes with the full round-trip oracle
// (parse + vocabulary + serialize + bounded fixpoint + content-loss check) so
// a serializer bug on in-vocabulary content gates the file to Raw instead of
// letting the first Rich save persist corrupted bytes. A pipeline THROW —
// markdown-doc deliberately rethrows non-depth errors as real bugs — degrades
// to Raw here too, rather than crashing the surface (the seedValue
// never-crash precedent). Residual window: the oracle sees bytes at open and
// save-settle; a bug triggered only by newly-typed content still lands ONE
// corrupt save before the post-save re-analysis flips the gate ("file went
// Raw mid-session" in triage = that save may already be on disk).
function safeGateReason(md: string): GateReason | null {
  try {
    return gateReasonFor(analyzeMarkdown(md));
  } catch (error) {
    console.error("Markdown gate analysis failed", error);
    return { kind: "parse-error", line: null, message: "Editor pipeline error" };
  }
}

// Pending deferred same-path analysis target — the microtask's identity check
// (superseded by newer content or cancelled by a path change, both
// replace/null this).
let pendingAnalysis: { path: string | null; content: string } | null = null;

/**
 * Publish a controller emission (provider-only). Runs the gate-analysis state
 * machine the provider previously ran in render — timing is SPLIT by what's
 * at stake:
 * - Path change: analyzed synchronously WITH the editor update (one setState),
 *   so the gate and the content can never disagree — a freshly opened
 *   Raw-only file must never mount the rich editor against unparseable bytes.
 *   The mode (raw/rich) is the user's choice, picked once per file open — a
 *   post-save flush (dirty→false, content unchanged) and an external/agent
 *   reload of the same file must not yank the user out of the surface they
 *   picked. (deriveOpenDoc shows rich only while the gate is clear, so a file
 *   that turns unparseable out from under us still falls back to raw.)
 * - Same-path content change (every 600ms autosave settle): deferred to a
 *   microtask (bounded latency; analyzeMarkdown is a full Slate construct +
 *   remark parse + serialize, up to 3 passes — running it synchronously
 *   blocked every autosave commit). The accepted window is one frame at most:
 *   the note is ALREADY rendered with the prior verdict for the same path.
 *   The microtask rechecks path+content against the LIVE store state before
 *   applying and drops itself when superseded or cancelled.
 * While the buffer is dirty (mid-typing, pre-autosave) the last analysis is
 * intentionally retained — one analysis pass per SAVED content change.
 */
export function publishEditor(editor: VaultEditorState): void {
  const s = useOpenNote.getState();
  const isMarkdownOpen = editor.path !== null && isMarkdownPath(editor.path);
  const pathChanged = s.analyzed.path !== editor.path;
  if ((pathChanged || s.analyzed.content !== editor.content) && !editor.dirty) {
    if (pathChanged) {
      pendingAnalysis = null; // cancel any deferred same-path pass
      const rawReason =
        isMarkdownOpen && editor.content.trim() !== "" ? safeGateReason(editor.content) : null;
      apply({
        editor,
        analyzed: { rawReason, content: editor.content, path: editor.path },
        mode: isMarkdownOpen && rawReason === null ? "rich" : "raw",
      });
      return;
    }
    const pending = pendingAnalysis;
    if (pending === null || pending.path !== editor.path || pending.content !== editor.content) {
      const target = { path: editor.path, content: editor.content };
      pendingAnalysis = target;
      queueMicrotask(() => {
        // Identity check: superseded by newer content or cancelled by a path
        // change (both replace/null pendingAnalysis) → this pass is stale.
        if (pendingAnalysis !== target) return;
        pendingAnalysis = null;
        // LIVE store read — never the snapshot captured at schedule time.
        const live = useOpenNote.getState();
        if (
          live.editor.path !== target.path ||
          live.editor.content !== target.content ||
          live.editor.dirty
        ) {
          return;
        }
        const markdownOpen = target.path !== null && isMarkdownPath(target.path);
        const rawReason =
          markdownOpen && target.content.trim() !== "" ? safeGateReason(target.content) : null;
        // A mid-session Rich→Raw flip (post-save re-analysis caught a
        // serializer bug, or an external reload landed unrepresentable
        // content) swaps Plate for the textarea under the user's cursor —
        // explain the yank once. Fresh opens (the path-change branch above)
        // don't toast: the badge covers them.
        if (
          live.analyzed.path === target.path &&
          live.analyzed.rawReason === null &&
          rawReason !== null &&
          live.mode === "rich"
        ) {
          toast.warning(`Switched to Raw editing — ${describeGateReason(rawReason)}`);
        }
        apply({ analyzed: { rawReason, content: target.content, path: target.path } });
      });
    }
  }
  apply({ editor });
}

/** Publish the intent path (provider-only, from applyOpenPath). Resets the
 * per-open html view choice; closing (null) also resets the editor snapshot
 * through the analysis machine so analyzed/mode clear exactly as they did
 * when the NO_NOTE state flowed through the provider's render. */
export function publishOpenPath(path: string | null): void {
  apply({ openPath: path, htmlAsText: false });
  if (path === null) publishEditor(NO_NOTE_STATE);
}

/** The user's raw/rich pick for a rich-capable markdown note (header toggle). */
export function setOpenNoteMode(mode: "raw" | "rich"): void {
  apply({ mode });
}

/** Show the open `.html` as raw text in the editor ("Open as text"). */
export function showOpenHtmlAsText(): void {
  apply({ htmlAsText: true });
}

/** Show the open `.html` as a sandboxed app again ("Open as app"). */
export function showOpenHtmlAsApp(): void {
  apply({ htmlAsText: false });
}
