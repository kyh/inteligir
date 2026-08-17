// Suggested edits in the document: each hunk of a pending proposal highlights
// its lines and carries an accept/reject pair at the end of the last one
// (issue #560).
//
// THE ACTIONS SIT IN THE TEXT COLUMN, NOT IN A CodeMirror GUTTER. A gutter is
// the obvious idiom and it was the first shape here; it is wrong for THIS
// editor. `.cm-content` is centred inside `.cm-scroller` (editor-theme's
// `max-width` + `margin-inline: auto`), and a gutter is laid out at the
// scroller's left edge — so the buttons landed ~190px from the lines they
// governed, which is not a gutter, it is two glyphs floating in the margin.
// Trying to pull the gutter rightwards is circular: the gutter's own width
// feeds the space the content centres within. An inline widget rides the text
// instead, so it is beside its hunk at every window width and needs no
// positioning arithmetic at all.
//
// HUNK POSITIONS ARE THE BASE'S LINE NUMBERS, and the buffer is not obliged to
// be the base — the user may have typed since the file was read. So this
// extension paints ONLY while the two agree, and reports `unplaceable` (with
// the count, for the doc surface to state) when they do not. That is a
// deliberate refusal rather than a gap: a decoration placed on drifted
// coordinates marks lines the hunk never described, and the accept button
// beside it would then look like it applies to the text it is pointing at.
// What earns the marks back is the buffer being saved or re-adopted, which
// the note's own controller does.
//
// Nothing here writes to the buffer. Accept and reject go to the host, which
// applies through the vault's compare-and-swap; the file coming back changes
// the buffer through the editor's ordinary external-change path, so the
// review layer and the editor never fight over the same bytes.

import {
  StateEffect,
  StateField,
  type EditorState,
  type Extension,
  type Range,
} from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";

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
export type ProposalMarksState =
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

export interface ProposalMarksConfig {
  onAccept: (hunk: ProposalHunkView) => void;
  onReject: (hunk: ProposalHunkView) => void;
}

export const setProposalHunks = StateEffect.define<ProposalMarksState>();

const IDLE: ProposalMarksState = { kind: "idle" };

/** The hunks to draw, or [] for every other state. */
function drawableHunks(state: ProposalMarksState): readonly ProposalHunkView[] {
  return state.kind === "ready" ? state.hunks : [];
}

/** What this hunk would do, in words — the buttons' accessible names, and
 *  their tooltips. Derived from the two line counts, because "3 lines become
 *  1" is the only description that is true of every hunk shape. */
function describeHunk(hunk: ProposalHunkView): string {
  const removed = hunk.baseEnd - hunk.baseStart;
  if (removed === 0) {
    return `add ${hunk.proposedLineCount} line(s)`;
  }
  if (hunk.proposedLineCount === 0) {
    return `remove ${removed} line(s)`;
  }
  return `replace ${removed} line(s) with ${hunk.proposedLineCount}`;
}

class HunkActionsWidget extends WidgetType {
  constructor(
    readonly hunk: ProposalHunkView,
    readonly config: ProposalMarksConfig,
  ) {
    super();
  }

  override eq(other: HunkActionsWidget): boolean {
    return (
      other.hunk.proposalId === this.hunk.proposalId &&
      other.hunk.revision === this.hunk.revision &&
      other.hunk.index === this.hunk.index &&
      other.hunk.baseStart === this.hunk.baseStart &&
      other.hunk.baseEnd === this.hunk.baseEnd
    );
  }

  override toDOM(): HTMLElement {
    const wrap = document.createElement("span");
    wrap.className = "cm-proposal-actions";
    const what = describeHunk(this.hunk);

    for (const action of [
      { className: "cm-proposal-accept", glyph: "✓", verb: "Accept", run: this.config.onAccept },
      { className: "cm-proposal-reject", glyph: "✕", verb: "Reject", run: this.config.onReject },
    ]) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = action.className;
      button.textContent = action.glyph;
      button.title = `${action.verb} this suggestion — ${what}`;
      button.setAttribute("aria-label", `${action.verb} suggested edit: ${what}`);
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

  /** The widget owns every event inside it; the editor must not also move the
   *  caret to the position it occupies. */
  override ignoreEvent(): boolean {
    return true;
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

interface MarksFieldValue {
  state: ProposalMarksState;
  decorations: DecorationSet;
}

function buildDecorations(
  editorState: EditorState,
  proposalState: ProposalMarksState,
  config: ProposalMarksConfig,
): DecorationSet {
  const lineDecoration = Decoration.line({ class: "cm-proposal-line" });
  const marks: Range<Decoration>[] = [];
  for (const hunk of drawableHunks(proposalState)) {
    const span = lineSpanOf(editorState, hunk);
    for (let line = span.from; line <= span.to; line += 1) {
      marks.push(lineDecoration.range(editorState.doc.line(line).from));
    }
    // At the END of the hunk's last line: the buttons trail the text they
    // govern rather than displacing it, and a hunk of any height gets exactly
    // one pair.
    const last = editorState.doc.line(span.to);
    marks.push(
      Decoration.widget({ widget: new HunkActionsWidget(hunk, config), side: 1 }).range(last.to),
    );
  }
  return Decoration.set(marks, true);
}

export function proposalMarksExtension(config: ProposalMarksConfig): Extension {
  const field = StateField.define<MarksFieldValue>({
    create: (state) => ({ state: IDLE, decorations: buildDecorations(state, IDLE, config) }),
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
        const next: ProposalMarksState =
          proposalState.kind === "ready"
            ? { kind: "unplaceable", count: proposalState.hunks.length }
            : proposalState;
        return { state: next, decorations: buildDecorations(tr.state, next, config) };
      }
      if (changed) {
        return {
          state: proposalState,
          decorations: buildDecorations(tr.state, proposalState, config),
        };
      }
      return value;
    },
    provide: (f) => EditorView.decorations.from(f, (value) => value.decorations),
  });

  return [field, proposalTheme];
}

const proposalTheme = EditorView.theme({
  ".cm-proposal-line": {
    background: "var(--proposal-line-bg, oklch(93% 0.05 150 / 0.4))",
  },
  ':root[data-theme="dark"] & .cm-proposal-line': {
    background: "oklch(45% 0.06 150 / 0.3)",
  },
  ".cm-proposal-actions": {
    display: "inline-flex",
    gap: "1px",
    marginLeft: "0.75em",
    verticalAlign: "baseline",
    userSelect: "none",
  },
  ".cm-proposal-accept, .cm-proposal-reject": {
    border: "1px solid var(--chip-border, oklch(88% 0.01 260))",
    borderRadius: "5px",
    background: "var(--pm-code-background-color)",
    padding: "0 0.4em",
    font: "inherit",
    fontSize: "0.75em",
    lineHeight: "1.6",
    cursor: "pointer",
    opacity: "0.8",
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
