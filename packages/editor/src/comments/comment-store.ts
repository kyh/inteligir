// What the editor's comment surface knows that the BYTES cannot say: which
// root ids the sidecar holds and which of those are resolved (the app pushes
// both off its comments query), plus the create-flow's pending state and the
// app-provided actions. A module store rather than context because decorate
// callbacks and key handlers run outside React.

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
  /** Viewport rect of the selection at ⌘⇧A, anchoring the popover. */
  rect: { top: number; left: number; bottom: number };
};

type CommentSurfaceState = {
  /** Root ids the sidecar holds for the open note. */
  knownIds: ReadonlySet<string>;
  /** The subset whose thread is resolved (renders de-emphasized). */
  resolvedIds: ReadonlySet<string>;
  actions: CommentActions | null;
  pendingCreate: PendingCreate | null;
};

const EMPTY: ReadonlySet<string> = new Set();

export const useCommentSurface = create<CommentSurfaceState>()(() => ({
  actions: null,
  knownIds: EMPTY,
  pendingCreate: null,
  resolvedIds: EMPTY,
}));

export function setCommentActions(actions: CommentActions | null): void {
  useCommentSurface.setState({ actions });
}

export function setCommentMeta(
  knownIds: ReadonlySet<string>,
  resolvedIds: ReadonlySet<string>,
): void {
  useCommentSurface.setState({ knownIds, resolvedIds });
}

export function setPendingCreate(pending: PendingCreate | null): void {
  useCommentSurface.setState({ pendingCreate: pending });
}
