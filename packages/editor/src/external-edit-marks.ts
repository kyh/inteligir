// Who wrote this? A tint over the spans an EXTERNAL write just put in the
// buffer — an agent's edit landing through the watcher, or the half of a
// three-way merge that came from disk — fading out on its own.
//
// The discriminator is already in the buffer: `replaceDoc` stamps every
// external replacement with `externalReplaceAnnotation`, so "this transaction
// was not the user" is a fact the transaction carries rather than something
// this module has to infer from timing or from who called what.
//
// NOTHING HERE ENTERS UNDO HISTORY. The marks are a StateField, so they never
// touch the document; the one transaction this module dispatches — the timer
// clearing them — says so explicitly, because an undo spent on removing a
// highlight is an undo the user's own last edit did not get.
//
// The residual, stated rather than hidden: a pure DELETION leaves no span in
// the new document, so nothing is tinted for it. Marking it would need a
// zero-width widget standing in for text that is gone, which says less than
// the count the host already reports.

import {
  StateEffect,
  StateField,
  Transaction,
  type EditorState,
  type Extension,
  type Range,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type PluginValue,
  type ViewUpdate,
} from "@codemirror/view";
import { externalReplaceAnnotation } from "./external-replace";

/** How long an attributed span stays on screen. Exported because a host
 *  saying something about the same write — a toast offering to jump to it —
 *  must not outlive the thing it points at. */
export const EXTERNAL_EDIT_FADE_MS = 6_000;

/** One span an external write changed, in current document coordinates. */
export interface ExternalEditRange {
  from: number;
  to: number;
}

const clearExternalEdits = StateEffect.define();

/** The inserted text's own span, with the line breaks and indentation that
 *  carried it left out: a tint is a statement about words, and one running
 *  through a line ending paints the empty width past the text. */
function trimmed(inserted: string, at: number): ExternalEditRange | null {
  const from = at + (inserted.length - inserted.trimStart().length);
  const to = at + inserted.trimEnd().length;
  return to > from ? { from, to } : null;
}

const externalEditMark = Decoration.mark({ class: "cm-external-edit" });

const externalEditField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(marks, tr) {
    for (const effect of tr.effects) {
      if (effect.is(clearExternalEdits)) {
        return Decoration.none;
      }
    }
    if (tr.annotation(externalReplaceAnnotation) !== true) {
      return marks.map(tr.changes);
    }
    // The newest write REPLACES the attribution rather than joining it: two
    // writes over one region would otherwise stack marks the reader reports
    // twice, and the fade below restarts for the newest one regardless.
    const added: Range<Decoration>[] = [];
    tr.changes.iterChanges((_fromA, _toA, fromB, toB) => {
      const span = trimmed(tr.newDoc.sliceString(fromB, toB), fromB);
      if (span !== null) {
        added.push(externalEditMark.range(span.from, span.to));
      }
    });
    return Decoration.set(added, true);
  },
  provide: (field) => EditorView.decorations.from(field),
});

/** Every span an external write is currently attributing, in document order.
 *  Empty once the fade has run, which is the point: what the host may still
 *  offer to show is exactly what is still on screen. */
export function externalEditRanges(state: EditorState): ExternalEditRange[] {
  const marks = state.field(externalEditField, false);
  if (marks === undefined) {
    return [];
  }
  const ranges: ExternalEditRange[] = [];
  for (let iter = marks.iter(); iter.value !== null; iter.next()) {
    ranges.push({ from: iter.from, to: iter.to });
  }
  return ranges;
}

class ExternalEditFade implements PluginValue {
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly view: EditorView) {}

  update(update: ViewUpdate): void {
    if (update.state.field(externalEditField).size === 0) {
      this.stop();
      return;
    }
    // A later external write restarts the window rather than inheriting the
    // remainder of the previous one: the newest span has to get its full show.
    const arrived = update.transactions.some(
      (tr) => tr.annotation(externalReplaceAnnotation) === true,
    );
    if (arrived || this.timer === null) {
      this.stop();
      this.timer = setTimeout(() => {
        this.timer = null;
        this.view.dispatch({
          effects: clearExternalEdits.of(null),
          annotations: Transaction.addToHistory.of(false),
        });
      }, EXTERNAL_EDIT_FADE_MS);
    }
  }

  destroy(): void {
    this.stop();
  }

  private stop(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}

const externalEditTheme = EditorView.theme({
  "&": {
    "--editor-external-edit": "oklch(88% 0.09 245 / 0.55)",
  },
  ':root[data-theme="dark"] &': {
    "--editor-external-edit": "oklch(52% 0.09 245 / 0.45)",
  },
  ".cm-external-edit": {
    borderRadius: "2px",
    backgroundColor: "var(--editor-external-edit)",
    animation: `cm-external-edit-fade ${String(EXTERNAL_EDIT_FADE_MS)}ms ease-out forwards`,
  },
  "@keyframes cm-external-edit-fade": {
    "0%, 55%": { backgroundColor: "var(--editor-external-edit)" },
    "100%": { backgroundColor: "transparent" },
  },
  "@media (prefers-reduced-motion: reduce)": {
    ".cm-external-edit": { animation: "none" },
  },
});

export const externalEditMarksExtension: Extension = [
  externalEditField,
  ViewPlugin.fromClass(ExternalEditFade),
  externalEditTheme,
];
