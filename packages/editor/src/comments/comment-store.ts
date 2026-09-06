// A module store rather than context: decorate callbacks and key handlers run
// outside React. Everything is keyed by note path because a sidecar answer or a
// pending create can land after the open note moved on.

import { create } from "zustand";

export type CommentActions = {
  /** False means refused; the caller strips the markers it minted. */
  create: (id: string, text: string) => Promise<boolean>;
  open: (ids: string[]) => void;
};

export type PendingCreate = {
  id: string;
  path: string;
  // the selection's box when the markers were minted: a virtual anchor for the create popup
  rect: { top: number; left: number; bottom: number; right: number; width: number; height: number };
};

export type CommentMeta = {
  knownIds: ReadonlySet<string>;
  resolvedIds: ReadonlySet<string>;
};

type CommentSurfaceState = {
  meta: ReadonlyMap<string, CommentMeta>;
  actions: CommentActions | null;
  pendingCreate: PendingCreate | null;
};

const EMPTY_META: CommentMeta = { knownIds: new Set<string>(), resolvedIds: new Set<string>() };
const NO_META: ReadonlyMap<string, CommentMeta> = new Map();

export const useCommentSurface = create<CommentSurfaceState>()(() => ({
  actions: null,
  meta: NO_META,
  pendingCreate: null,
}));

// a note with no published meta yet reads as empty, so its ranges render as orphans until the sidecar loads
export function useCommentMeta(path: string | null): CommentMeta {
  return useCommentSurface((state) =>
    path === null ? EMPTY_META : (state.meta.get(path) ?? EMPTY_META),
  );
}

export function setCommentActions(actions: CommentActions | null): void {
  useCommentSurface.setState({ actions });
}

export function setCommentMeta(path: string, meta: CommentMeta): void {
  useCommentSurface.setState((state) => ({ meta: new Map(state.meta).set(path, meta) }));
}

export function clearCommentMeta(path: string): void {
  useCommentSurface.setState((state) => {
    if (!state.meta.has(path)) return state;
    const next = new Map(state.meta);
    next.delete(path);
    return { meta: next };
  });
}

export function setPendingCreate(pending: PendingCreate | null): void {
  useCommentSurface.setState({ pendingCreate: pending });
}
