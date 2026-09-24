// Keyed by path so a consumer never grabs a stale editor serving another note: a note switch
// mounts a new editor, and the outgoing one must stop answering for the incoming path.

import type { SlateEditor } from "platejs";
import { useSyncExternalStore } from "react";

const editors = new Map<string, SlateEditor>();
// weak: a strong reverse map would pin every editor a session built.
const paths = new WeakMap<SlateEditor, string>();
// one channel for a registration and an edit alike: the column shows one note, so a reader
// re-checking its snapshot on a change it does not care about costs a lookup
const listeners = new Set<() => void>();

const notify = (): void => {
  for (const listener of listeners) {
    listener();
  }
};

export const subscribeLiveEditors = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const registerLiveEditor = (path: string, editor: SlateEditor): (() => void) => {
  editors.set(path, editor);
  paths.set(editor, path);
  notify();
  return () => {
    if (editors.get(path) === editor) {
      editors.delete(path);
      notify();
    }
  };
};

// Slate has one onChange slot and the Plate surface owns it, so the surface announces each
// edit here for the readers outside its tree.
export const announceLiveEditorEdit = (): void => {
  notify();
};

export const getLiveEditor = (path: string): SlateEditor | null => editors.get(path) ?? null;

export const liveEditorPath = (editor: SlateEditor): string | null => paths.get(editor) ?? null;

// whether `editor` still serves its note: an unmounted one keeps its last path but no longer
// answers for it, so an insert that awaited must not land in it.
export const isLiveEditor = (editor: SlateEditor): boolean => {
  const path = paths.get(editor);
  return path !== undefined && editors.get(path) === editor;
};

// a render must subscribe, never read getLiveEditor: the editor registers after the render that
// asked for it, and nothing else would draw that render again
export const useLiveEditor = (path: string | null): SlateEditor | null =>
  useSyncExternalStore(subscribeLiveEditors, () => (path === null ? null : getLiveEditor(path)));

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
  const settled = Promise.withResolvers<SlateEditor | null>();
  const unsubscribe = subscribeLiveEditors(() => {
    const mounted = editors.get(path);
    if (mounted !== undefined) {
      settled.resolve(mounted);
    }
  });
  const timer = setTimeout(() => {
    settled.resolve(null);
  }, timeoutMs);
  try {
    return await settled.promise;
  } finally {
    clearTimeout(timer);
    unsubscribe();
  }
};
