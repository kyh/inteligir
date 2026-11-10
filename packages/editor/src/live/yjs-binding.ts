// An editor bound to a note's live document: every op Slate applies is the document's, whoever
// applies it, and undo walks only this editor's own changes.

import { NodeIdPlugin, createSlatePlugin } from "platejs";
import type { SlateEditor } from "platejs";
import { YHistoryEditor, YjsEditor, withYHistory, withYjs } from "@slate-yjs/core";
import { Editor } from "slate";
import * as Y from "yjs";

// the one shared type a note's document holds: its blocks, in order
export const noteRoot = (doc: Y.Doc): Y.XmlText => doc.get("content", Y.XmlText);

// Plate extends the editor plugin by plugin in priority order, each wrapping the one before, so
// the first applied is the innermost: above every kit plugin (Plate's default is 100), the binding
// stores each op as the plugins outside it left it, NodeIdPlugin's ids included, and an op a
// plugin refuses never reaches the document.
const INNERMOST = 1000;

// Applying the document's own change: an op that happened elsewhere, which Slate takes verbatim
// since the document already holds it. A plugin that rewrites or refuses an op lets this one pass,
// or the editor and the document part.
export const appliesRemoteChange = (editor: SlateEditor): boolean =>
  YjsEditor.isYjsEditor(editor) && YjsEditor.connected(editor) && !YjsEditor.isLocal(editor);

// `localOrigin` names this editor's writes in the document, which its undo tracks and every other
// editor reads as remote. The host connects it (`YjsEditor.connect`) once the document has synced,
// so an editor never seeds a document it has yet to read.
export const yjsBindingPlugin = ({
  root,
  localOrigin,
}: {
  readonly root: Y.XmlText;
  readonly localOrigin: unknown;
}) =>
  createSlatePlugin({
    extendEditor: ({ editor }) => {
      // Plate types its editor apart from slate's, which it is at runtime
      if (!Editor.isEditor(editor)) {
        throw new Error("yjsBindingPlugin binds a slate editor");
      }
      const bound = withYjs(editor, root, { autoConnect: false, localOrigin });
      // NodeIdPlugin renames an inserted node whose id the editor already holds, which a remote
      // move does (it lands as an insert before its delete), and names one that came without
      const filter = editor.getOption(NodeIdPlugin, "filter");
      editor.setOption(
        NodeIdPlugin,
        "filter",
        (entry) => !appliesRemoteChange(editor) && (filter === undefined || filter(entry)),
      );
      return bound;
    },
    key: "yjsBinding",
    priority: INNERMOST,
  });

// Whether an edit made now reaches the note: an editor shown read-only takes none, and a bound one
// that is not connected writes nothing to its document.
export const editsReachNote = (editor: SlateEditor): boolean =>
  !editor.dom.readOnly && (!YjsEditor.isYjsEditor(editor) || YjsEditor.connected(editor));

// Hands the document every edit Slate has yet to settle, which it otherwise hands over a moment
// after the edit, once its change settles.
export const flushEdits = (editor: SlateEditor): void => {
  if (YjsEditor.isYjsEditor(editor) && YjsEditor.connected(editor)) {
    YjsEditor.flushLocalChanges(editor);
  }
};

// What this editor's undo and redo would take back: the document's stacks for a bound editor,
// Plate's own for one that is not.
export const undoStackSizes = (editor: SlateEditor): { undos: number; redos: number } =>
  YHistoryEditor.isYHistoryEditor(editor)
    ? {
        redos: editor.undoManager.redoStack.length,
        undos: editor.undoManager.undoStack.length,
      }
    : { redos: editor.history.redos.length, undos: editor.history.undos.length };

// Runs `fn` as an undo step of its own: the UndoManager merges changes that come within its
// capture window, so the typing just before and just after would otherwise join it.
export const ownUndoStep = (editor: SlateEditor, fn: () => void): void => {
  if (!YHistoryEditor.isYHistoryEditor(editor)) {
    fn();
    return;
  }
  flushEdits(editor);
  editor.undoManager.stopCapturing();
  fn();
  flushEdits(editor);
  editor.undoManager.stopCapturing();
};

// Runs `fn` so its writes stay out of this editor's undo; on throw too, since the origin
// slate-yjs swaps in is not restored when `fn` throws, and every later edit would go untracked.
const untracked = (editor: YHistoryEditor, fn: () => void): void => {
  const thrown: Error[] = [];
  YHistoryEditor.withoutSaving(editor, () => {
    try {
      fn();
    } catch (error) {
      thrown.push(error instanceof Error ? error : new Error(String(error)));
    }
  });
  const [error] = thrown;
  if (error !== undefined) {
    throw error;
  }
};

// Undo and redo are the document's: a Y.UndoManager over the binding's local origin, so they take
// back this editor's changes and no one else's. `editor.tf.withoutSaving` keeps a write out of it
// (a formula's display). It sits beside Plate's HistoryPlugin rather than replacing it, since
// Plate's own readers of `editor.history` stay, as @platejs/yjs's history does.
export const YHistoryPlugin = createSlatePlugin({
  extendEditor: ({ editor }) => {
    if (!YjsEditor.isYjsEditor(editor)) {
      throw new Error("YHistoryPlugin needs yjsBindingPlugin on the same editor");
    }
    return withYHistory(editor);
  },
  key: "yHistory",
}).overrideEditor(({ editor, tf: { withoutSaving } }) => ({
  transforms: {
    withoutSaving(fn) {
      if (YHistoryEditor.isYHistoryEditor(editor)) {
        untracked(editor, () => {
          withoutSaving(fn);
        });
        return;
      }
      withoutSaving(fn);
    },
  },
}));
