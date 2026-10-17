// A module store rather than context: decorate callbacks and key handlers run
// outside React. Everything is keyed by note path because a store answer or a
// pending create can land after the open note moved on.

import { create } from "zustand";

export interface PendingCreate {
  id: string;
  path: string;
  // the selection's text when the markers were minted: what the annotation records it was made on
  quote: string;
  // the selection's box when the markers were minted: a virtual anchor for the create popup
  rect: { top: number; left: number; bottom: number; right: number; width: number; height: number };
}

export interface AnnotationMeta {
  knownIds: ReadonlySet<string>;
}

interface AnnotationSurfaceState {
  meta: ReadonlyMap<string, AnnotationMeta>;
  pendingCreate: PendingCreate | null;
}

const EMPTY_META: AnnotationMeta = { knownIds: new Set<string>() };
const NO_META: ReadonlyMap<string, AnnotationMeta> = new Map();

export const useAnnotationSurface = create<AnnotationSurfaceState>()(() => ({
  meta: NO_META,
  pendingCreate: null,
}));

// a note with no published meta yet reads as empty, so its ranges render as orphans until the store loads
export const useAnnotationMeta = (path: string | null): AnnotationMeta =>
  useAnnotationSurface((state) =>
    path === null ? EMPTY_META : (state.meta.get(path) ?? EMPTY_META),
  );

export const setAnnotationMeta = (path: string, meta: AnnotationMeta): void => {
  useAnnotationSurface.setState((state) => ({ meta: new Map(state.meta).set(path, meta) }));
};

export const clearAnnotationMeta = (path: string): void => {
  useAnnotationSurface.setState((state) => {
    if (!state.meta.has(path)) {
      return state;
    }
    const next = new Map(state.meta);
    next.delete(path);
    return { meta: next };
  });
};

export const setPendingCreate = (pending: PendingCreate | null): void => {
  useAnnotationSurface.setState({ pendingCreate: pending });
};

// a save that resolves late must not clear a create armed after it
export const clearPendingCreate = (id: string): void => {
  useAnnotationSurface.setState((state) =>
    state.pendingCreate?.id === id ? { pendingCreate: null } : state,
  );
};
