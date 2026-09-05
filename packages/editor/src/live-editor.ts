// Keyed by path so a consumer never grabs a stale editor serving another note: a note switch
// mounts a new editor, and the outgoing one must stop answering for the incoming path.

import type { SlateEditor } from "platejs";

const editors = new Map<string, SlateEditor>();
// weak: a strong reverse map would pin every editor a session built.
const paths = new WeakMap<SlateEditor, string>();
const waiters = new Map<string, Set<(editor: SlateEditor) => void>>();

export function registerLiveEditor(path: string, editor: SlateEditor): () => void {
  editors.set(path, editor);
  paths.set(editor, path);
  const waiting = waiters.get(path);
  if (waiting !== undefined) {
    waiters.delete(path);
    for (const resolve of waiting) resolve(editor);
  }
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

// the editor serving `path` once it mounts; bounded, because a refused navigation mounts
// nothing and the caller would otherwise wait forever
export function whenLiveEditor(path: string, timeoutMs: number): Promise<SlateEditor | null> {
  const live = editors.get(path);
  if (live !== undefined) return Promise.resolve(live);
  return new Promise((resolve) => {
    const pending = waiters.get(path) ?? new Set<(editor: SlateEditor) => void>();
    waiters.set(path, pending);
    const finish = (editor: SlateEditor | null): void => {
      clearTimeout(timer);
      pending.delete(finish);
      if (pending.size === 0 && waiters.get(path) === pending) waiters.delete(path);
      resolve(editor);
    };
    const timer = setTimeout(() => {
      finish(null);
    }, timeoutMs);
    pending.add(finish);
  });
}
