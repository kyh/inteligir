// Keyed by path so a consumer never grabs a stale editor serving another note: a note switch
// mounts a new editor, and the outgoing one must stop answering for the incoming path.

import type { SlateEditor } from "platejs";

const editors = new Map<string, SlateEditor>();
// weak: a strong reverse map would pin every editor a session built.
const paths = new WeakMap<SlateEditor, string>();

export const registerLiveEditor = (path: string, editor: SlateEditor): (() => void) => {
  editors.set(path, editor);
  paths.set(editor, path);
  return () => {
    if (editors.get(path) === editor) {
      editors.delete(path);
    }
  };
};

export const getLiveEditor = (path: string): SlateEditor | null => editors.get(path) ?? null;

export const liveEditorPath = (editor: SlateEditor): string | null => paths.get(editor) ?? null;

// whether `editor` still serves its note: an unmounted one keeps its last path but no longer
// answers for it, so an insert that awaited must not land in it.
export const isLiveEditor = (editor: SlateEditor): boolean => {
  const path = paths.get(editor);
  return path !== undefined && editors.get(path) === editor;
};
