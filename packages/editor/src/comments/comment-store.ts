// What the editor's comment surface knows that the BYTES cannot say: which
// root ids a note's sidecar holds and which of those are resolved (the app
// pushes both off its comments query), plus the create-flow's pending state
// and the app-provided actions. A module store rather than context because
// decorate callbacks and key handlers run outside React.
//
// Everything here is keyed by the note's path, because this module outlives
// the document it describes: the sidecar arrives from a query and the pending
// create from a keystroke, both of which can land after the open note moved
// on. An unkeyed slot would tint the newly opened note's ranges against the
// PREVIOUS note's ids, and draw the create popover over a document that never
// minted the markers its cancel would strip.

import { create } from "zustand";

export type CommentActions = {
  /** Persist the note (the route derives `anchored` from disk), then add the
   * root entry. False = refused; the caller strips the markers it minted. */
  create: (id: string, text: string) => Promise<boolean>;
  /** A tinted range was clicked; the app focuses its thread. */
  open: (ids: string[]) => void;
};

export type PendingCreate = {
  id: string;
  /** The note whose document minted the marker pair. The popover is drawn
   * only while that note is open, so cancel and save reach the editor that
   * actually holds the markers. */
  path: string;
  /** Viewport rect of the selection at ⌘⇧A, anchoring the popover. */
  rect: { top: number; left: number; bottom: number };
};

/** One note's sidecar, as the tint needs it. */
export type CommentMeta = {
  /** Root ids the sidecar holds. */
  knownIds: ReadonlySet<string>;
  /** The subset whose thread is resolved (renders de-emphasized). */
  resolvedIds: ReadonlySet<string>;
};

type CommentSurfaceState = {
  /** Sidecar meta per note path. */
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

/** What is known about `path`'s own sidecar. A note nobody has published for
 * yet reads as empty, which renders its ranges as orphans — the honest answer
 * while the sidecar is still loading. */
export function useCommentMeta(path: string | null): CommentMeta {
  return useCommentSurface((state) =>
    path === null ? EMPTY_META : (state.meta.get(path) ?? EMPTY_META),
  );
}

export function setCommentActions(actions: CommentActions | null): void {
  useCommentSurface.setState({ actions });
}

/** Publish one note's sidecar ids, under the note they belong to. */
export function setCommentMeta(path: string, meta: CommentMeta): void {
  useCommentSurface.setState((state) => ({ meta: new Map(state.meta).set(path, meta) }));
}

/** Drop a note's meta — it closed, or the editor moved to another note. */
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
