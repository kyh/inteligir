// What the editor's comment surface knows that the BYTES cannot say: which
// root ids a note's sidecar holds and which of those are resolved (the app
// pushes both off its comments query), plus the create-flow's pending state
// and the app-provided actions. A module store rather than context because
// decorate callbacks and key handlers run outside React.
//
// Everything a PANE could disagree about is keyed by the note's path: a split
// holds two panes and one note lives in one pane, so the path names the pane.
// One shared slot would tint a background pane's ranges against the focused
// note's ids, and draw the create popover in both panes at once — where the
// topmost host's cancel strips markers out of an editor that never minted them.

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
  /** The note whose pane minted the marker pair. Only that pane's host draws
   * the popover, so cancel and save reach the editor holding the markers. */
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
  /** Sidecar meta per note path — one entry per pane showing a note. */
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

/** What the pane showing `path` knows about its own note. A note nobody has
 * published for yet reads as empty, which renders its ranges as orphans —
 * the honest answer while the sidecar is still loading. */
export function useCommentMeta(path: string | null): CommentMeta {
  return useCommentSurface((state) =>
    path === null ? EMPTY_META : (state.meta.get(path) ?? EMPTY_META),
  );
}

export function setCommentActions(actions: CommentActions | null): void {
  useCommentSurface.setState({ actions });
}

/** Publish one note's sidecar ids. The pane showing the note owns the call. */
export function setCommentMeta(path: string, meta: CommentMeta): void {
  useCommentSurface.setState((state) => ({ meta: new Map(state.meta).set(path, meta) }));
}

/** Drop a note's meta — its pane closed, or moved to another note. */
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
