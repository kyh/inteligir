import { EditorState, type Extension, type Text } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
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
  focus(): void;
  destroy(): void;
}

/** Mounts a CodeMirror 6 markdown live-preview editor. Framework-free. */
export const createMarkdownEditor = (config: MarkdownEditorConfig): MarkdownEditor => {
  const { parent, doc = "", onDocChanged, extensions = [], onOpenLink } = config;
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [
        markdownEditorExtensions(onOpenLink === undefined ? {} : { onOpenLink }),
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
    focus: () => {
      view.focus();
    },
    destroy: () => {
      view.destroy();
    },
  };
};
