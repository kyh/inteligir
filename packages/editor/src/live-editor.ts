// Keyed by path so a consumer never grabs a stale editor serving another note: a note switch
// mounts a new editor, and the outgoing one must stop answering for the incoming path.

import type { SlateEditor } from "platejs";

const editors = new Map<string, SlateEditor>();
// weak: a strong reverse map would pin every editor a session built.
const paths = new WeakMap<SlateEditor, string>();
const waiters = new Map<string, Set<(editor: SlateEditor) => void>>();

export const registerLiveEditor = (path: string, editor: SlateEditor): (() => void) => {
  editors.set(path, editor);
  paths.set(editor, path);
  const waiting = waiters.get(path);
  if (waiting !== undefined) {
    waiters.delete(path);
    for (const resolve of waiting) {
      resolve(editor);
    }
  }
  return () => {
    if (editors.get(path) === editor) {
      editors.delete(path);
    }
  };
};

export const getLiveEditor = (path: string): SlateEditor | null => editors.get(path) ?? null;

export const liveEditorPath = (editor: SlateEditor): string | null => paths.get(editor) ?? null;

// the editor serving `path` once it mounts; bounded, because a refused navigation mounts
// nothing and the caller would otherwise wait forever
export const whenLiveEditor = async (
  path: string,
  timeoutMs: number,
): Promise<SlateEditor | null> => {
  const live = editors.get(path);
  if (live !== undefined) {
    return live;
  }
  const pending = waiters.get(path) ?? new Set<(editor: SlateEditor) => void>();
  waiters.set(path, pending);
  const settled = Promise.withResolvers<SlateEditor | null>();
  const finish = (editor: SlateEditor | null): void => {
    pending.delete(finish);
    if (pending.size === 0 && waiters.get(path) === pending) {
      waiters.delete(path);
    }
    settled.resolve(editor);
  };
  const timer = setTimeout(() => {
    finish(null);
  }, timeoutMs);
  pending.add(finish);
  try {
    return await settled.promise;
  } finally {
    clearTimeout(timer);
  }
};
