import { EditorState, Transaction, type Extension, type Text } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { externalReplaceAnnotation, externalReplaceChanges } from "./external-replace";
import { type MarkdownEditorOptions, markdownEditorExtensions } from "./markdown-editor-extensions";

export interface MarkdownEditorConfig extends MarkdownEditorOptions {
  /** Element the editor mounts into. */
  parent: HTMLElement;
  /** Initial markdown. The buffer IS the file: every byte round-trips. */
  doc?: string;
  /** Called with the buffer after every document change. Hands over the CM
   * `Text` (an immutable rope) rather than a string: serializing here would
   * copy the whole document on every keystroke — the consumer serializes at
   * flush time. */
  onDocChanged?: (doc: Text) => void;
  /** Extra extensions, appended after the house stack. */
  extensions?: Extension[];
}

export interface MarkdownEditor {
  readonly view: EditorView;
  getDoc(): string;
  /** Replaces the whole buffer (external file change); resets the selection. */
  setDoc(doc: string): void;
  /** Replaces the buffer as per-hunk line changes (shared Myers diff), so the
   * selection maps through unchanged regions instead of resetting — the
   * external update path for a buffer the user may be sitting in. Excluded
   * from undo history and stamped with `externalReplaceAnnotation`. */
  replaceDoc(doc: string): void;
  focus(): void;
  destroy(): void;
}

/** Mounts a CodeMirror 6 markdown live-preview editor. Framework-free. */
export const createMarkdownEditor = (config: MarkdownEditorConfig): MarkdownEditor => {
  const { parent, doc = "", onDocChanged, extensions = [], onOpenLink, onOpenTag } = config;
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [
        markdownEditorExtensions({
          ...(onOpenLink === undefined ? {} : { onOpenLink }),
          ...(onOpenTag === undefined ? {} : { onOpenTag }),
        }),
        onDocChanged
          ? EditorView.updateListener.of((update) => {
              if (update.docChanged) onDocChanged(update.state.doc);
            })
          : [],
        extensions,
      ],
    }),
  });
  return {
    view,
    getDoc: () => view.state.doc.toString(),
    setDoc: (next) => {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: next },
      });
    },
    replaceDoc: (next) => {
      const current = view.state.doc.toString();
      if (next === current) return;
      // Per-hunk changes rather than one whole-doc replacement: a cursor in
      // any unchanged region — including one between two edits — maps through
      // untouched. Kept out of history so Undo can never resurrect content
      // the disk no longer holds.
      view.dispatch({
        changes: externalReplaceChanges(current, next),
        annotations: [Transaction.addToHistory.of(false), externalReplaceAnnotation.of(true)],
      });
    },
    focus: () => {
      view.focus();
    },
    destroy: () => {
      view.destroy();
    },
  };
};
