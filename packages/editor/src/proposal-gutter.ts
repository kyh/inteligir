// Suggested edits in the gutter: each hunk of a pending proposal marks its
// lines and hangs an accept/reject pair beside them (issue #560).
//
// HUNK POSITIONS ARE THE BASE'S LINE NUMBERS, and the buffer is not obliged to
// be the base — the user may have typed since the file was read. So this
// extension paints ONLY while the two agree, and reports `unplaceable` (with
// the count, for the doc surface to state) when they do not. That is a
// deliberate refusal rather than a gap: a decoration placed on drifted
// coordinates marks lines the hunk never described, and the accept button
// beside it would then look like it applies to the text it is pointing at.
// What earns the gutter back is the buffer being saved or re-adopted, which
// the note's own controller does.
//
// Nothing here writes to the buffer. Accept and reject go to the host, which
// applies through the vault's compare-and-swap; the file coming back changes
// the buffer through the editor's ordinary external-change path, so the
// proposal and the editor never fight over the same bytes.

import { StateEffect, StateField, type EditorState, type Extension } from "@codemirror/state";
import { Decoration, EditorView, gutter, GutterMarker, type DecorationSet } from "@codemirror/view";

/** One reviewable region, exactly as the host derived it. */
export interface ProposalHunkView {
  proposalId: string;
  /** The revision the host derived these hunks from; every verb names it. */
  revision: number;
  index: number;
  /** Base line numbers, half-open, 0-based. */
  baseStart: number;
  baseEnd: number;
  /** What the proposal would put there — for the count in the label. */
  proposedLineCount: number;
}

/** What the app knows about this doc's suggestions. The three states differ in
 *  what may be OFFERED, which is why they are not one nullable list. */
export type ProposalGutterState =
  /** Not asked yet, or asked and still waiting. Nothing is drawn. */
  | { kind: "idle" }
  /** Reviewable here and now: the buffer matches every hunk's base. */
  | { kind: "ready"; hunks: readonly ProposalHunkView[] }
  /**
   * Suggestions exist but cannot be placed — the base moved, or the buffer
   * holds unsaved edits. The count is still worth stating; the doc surface
   * renders it, and this extension draws nothing.
   */
  | { kind: "unplaceable"; count: number };

export interface ProposalGutterConfig {
  onAccept: (hunk: ProposalHunkView) => void;
  onReject: (hunk: ProposalHunkView) => void;
}

export const setProposalHunks = StateEffect.define<ProposalGutterState>();

const IDLE: ProposalGutterState = { kind: "idle" };

/** The hunks to draw, or [] for every other state. */
function drawableHunks(state: ProposalGutterState): readonly ProposalHunkView[] {
  return state.kind === "ready" ? state.hunks : [];
}

class HunkMarker extends GutterMarker {
  constructor(
    readonly hunk: ProposalHunkView,
    readonly config: ProposalGutterConfig,
  ) {
    super();
  }

  override eq(other: HunkMarker): boolean {
    return (
      other.hunk.proposalId === this.hunk.proposalId &&
      other.hunk.revision === this.hunk.revision &&
      other.hunk.index === this.hunk.index
    );
  }

  override toDOM(): HTMLElement {
    const wrap = document.createElement("span");
    wrap.className = "cm-proposal-actions";
    const removed = this.hunk.baseEnd - this.hunk.baseStart;
    const label =
      removed === 0
        ? `Suggested: add ${this.hunk.proposedLineCount} line(s)`
        : this.hunk.proposedLineCount === 0
          ? `Suggested: remove ${removed} line(s)`
          : `Suggested: replace ${removed} line(s)`;

    for (const action of [
      { className: "cm-proposal-accept", glyph: "✓", verb: "Accept", run: this.config.onAccept },
      { className: "cm-proposal-reject", glyph: "✕", verb: "Reject", run: this.config.onReject },
    ]) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = action.className;
      button.textContent = action.glyph;
      button.title = `${action.verb} — ${label}`;
      button.setAttribute("aria-label", `${action.verb} suggestion: ${label}`);
      // mousedown would move the caret into the marked lines first.
      button.addEventListener("mousedown", (event) => event.preventDefault());
      button.addEventListener("click", (event) => {
        event.preventDefault();
        action.run(this.hunk);
      });
      wrap.append(button);
    }
    return wrap;
  }
}

/** The document line numbers (1-based) a hunk covers, clamped to the doc. An
 *  insertion (zero-width base span) marks the line it sits before. */
function lineSpanOf(state: EditorState, hunk: ProposalHunkView): { from: number; to: number } {
  const lastLine = state.doc.lines;
  const from = Math.min(Math.max(hunk.baseStart + 1, 1), lastLine);
  const to = Math.min(Math.max(hunk.baseEnd, from), lastLine);
  return { from, to };
}

interface GutterFieldValue {
  state: ProposalGutterState;
  decorations: DecorationSet;
}

function buildDecorations(
  editorState: EditorState,
  proposalState: ProposalGutterState,
): DecorationSet {
  const lineDecoration = Decoration.line({ class: "cm-proposal-line" });
  const marks = [];
  for (const hunk of drawableHunks(proposalState)) {
    const span = lineSpanOf(editorState, hunk);
    for (let line = span.from; line <= span.to; line += 1) {
      marks.push(lineDecoration.range(editorState.doc.line(line).from));
    }
  }
  return Decoration.set(marks, true);
}

export function proposalGutterExtension(config: ProposalGutterConfig): Extension {
  const field = StateField.define<GutterFieldValue>({
    create: (state) => ({ state: IDLE, decorations: buildDecorations(state, IDLE) }),
    update(value, tr) {
      let proposalState = value.state;
      let changed = false;
      for (const effect of tr.effects) {
        if (effect.is(setProposalHunks)) {
          proposalState = effect.value;
          changed = true;
        }
      }
      // A doc change invalidates the placement outright: the app re-derives
      // from the saved file and pushes a fresh state, and until it does the
      // safe answer is to draw nothing rather than mapped-forward marks that
      // no longer name the hunk's own lines.
      if (tr.docChanged) {
        const next: ProposalGutterState =
          proposalState.kind === "ready"
            ? { kind: "unplaceable", count: proposalState.hunks.length }
            : proposalState;
        return { state: next, decorations: buildDecorations(tr.state, next) };
      }
      if (changed) {
        return { state: proposalState, decorations: buildDecorations(tr.state, proposalState) };
      }
      return value;
    },
    provide: (f) => EditorView.decorations.from(f, (value) => value.decorations),
  });

  const markers = gutter({
    class: "cm-proposal-gutter",
    lineMarker(view, line) {
      const value = view.state.field(field, false);
      if (value === undefined) {
        return null;
      }
      const lineNumber = view.state.doc.lineAt(line.from).number;
      const hunk = drawableHunks(value.state).find(
        (candidate) => lineSpanOf(view.state, candidate).from === lineNumber,
      );
      return hunk === undefined ? null : new HunkMarker(hunk, config);
    },
    // Without this the gutter never re-renders when the effect lands.
    lineMarkerChange: (update) =>
      update.transactions.some((tr) => tr.effects.some((effect) => effect.is(setProposalHunks))),
  });

  return [field, markers, proposalTheme];
}

const proposalTheme = EditorView.theme({
  ".cm-proposal-line": {
    background: "var(--proposal-line-bg, oklch(93% 0.05 150 / 0.35))",
  },
  ':root[data-theme="dark"] & .cm-proposal-line': {
    background: "oklch(45% 0.06 150 / 0.28)",
  },
  ".cm-proposal-gutter": {
    minWidth: "2.6em",
  },
  ".cm-proposal-actions": {
    display: "inline-flex",
    gap: "1px",
    paddingRight: "0.25em",
  },
  ".cm-proposal-accept, .cm-proposal-reject": {
    border: "none",
    background: "none",
    padding: "0 0.15em",
    font: "inherit",
    fontSize: "0.8em",
    lineHeight: "1.4",
    cursor: "pointer",
    opacity: "0.65",
  },
  ".cm-proposal-accept:hover, .cm-proposal-reject:hover": {
    opacity: "1",
  },
  ".cm-proposal-accept": {
    color: "var(--chip-positive, oklch(62% 0.1 150))",
  },
  ".cm-proposal-reject": {
    color: "var(--chip-negative, oklch(58% 0.16 25))",
  },
});
