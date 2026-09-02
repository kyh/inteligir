// Keyed by path so a consumer never grabs a stale editor serving another note: a note switch
// mounts a new editor, and the outgoing one must stop answering for the incoming path.

import type { SlateEditor } from "platejs";

const editors = new Map<string, SlateEditor>();
// weak: a strong reverse map would pin every editor a session built.
const paths = new WeakMap<SlateEditor, string>();

export function registerLiveEditor(path: string, editor: SlateEditor): () => void {
  editors.set(path, editor);
  paths.set(editor, path);
  return () => {
    if (editors.get(path) === editor) editors.delete(path);
  };
}

export function getLiveEditor(path: string): SlateEditor | null {
  return editors.get(path) ?? null;
}

export function liveEditorPath(editor: SlateEditor): string | null {
  return paths.get(editor) ?? null;
}
