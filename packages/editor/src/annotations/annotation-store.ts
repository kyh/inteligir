// A module store rather than context: decorate callbacks and key handlers run
// outside React. Everything is keyed by note path because a store answer or a
// pending note can land after the open item moved on.

import { create } from "zustand";

// the selection's box when the markers were minted: the note popover's virtual anchor, since the
// selection itself is gone once the field takes focus
export interface AnchorRect {
  top: number;
  left: number;
  bottom: number;
  right: number;
  width: number;
  height: number;
}

// a highlight just made, whose note the popover offers: `created` is the host's answer to the
// highlight's own entry, which a note waits on, since an edit of an entry not yet written is refused
export interface PendingNote {
  id: string;
  path: string;
  rect: AnchorRect;
  created: Promise<boolean>;
}

export interface AnnotationMeta {
  knownIds: ReadonlySet<string>;
  // the ids whose annotation carries a note or a reply, which the gutter marks. Absent where the
  // host draws no gutter (the phone's page), which publishes the ids its ranges tint by alone.
  notedIds?: ReadonlySet<string>;
}

interface AnnotationSurfaceState {
  meta: ReadonlyMap<string, AnnotationMeta>;
  pendingNote: PendingNote | null;
}

const EMPTY_META: AnnotationMeta = { knownIds: new Set<string>(), notedIds: new Set<string>() };
const NO_META: ReadonlyMap<string, AnnotationMeta> = new Map();

export const useAnnotationSurface = create<AnnotationSurfaceState>()(() => ({
  meta: NO_META,
  pendingNote: null,
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

export const setPendingNote = (pending: PendingNote | null): void => {
  useAnnotationSurface.setState({ pendingNote: pending });
};

// a popover closing late must not close the one a later highlight opened
export const clearPendingNote = (id: string): void => {
  useAnnotationSurface.setState((state) =>
    state.pendingNote?.id === id ? { pendingNote: null } : state,
  );
};
