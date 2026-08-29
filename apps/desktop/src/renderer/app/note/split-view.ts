// Split-view plumbing shared between the workspace and the panes: the pane
// vocabulary, and the coordinator that enforces one-note-one-pane and
// PUBLISHES the focused pane with its path. One channel, two ways to read it —
// React selects off `store`, action-time callers ask `getState()` — so the
// shell's focus state cannot drift from the panes' own.

import type { OpenNoteState, OpenNoteStore } from "@repo/editor/note/open-note-store";
import { createStore, type StoreApi } from "zustand/vanilla";

type PaneId = "primary" | "split";

/** The published fact: which pane has focus, and the note it holds. */
type PaneFocus = {
  pane: PaneId;
  path: string | null;
};

export type PaneCoordinator = {
  /** The focus, subscribable: `useStore(coordinator.store, sel)` in React,
   * `coordinator.store.getState()` at action time. */
  readonly store: StoreApi<PaneFocus>;
  /** A named pane's live open path (the focused one is in `store`). */
  openPath: (pane: PaneId) => string | null;
  /** A pane reports its open path on every publish. */
  reportOpenPath: (pane: PaneId, path: string | null) => void;
  /**
   * One note lives in ONE pane: an open targeting a path the other pane
   * already holds FOCUSES that pane instead (two runtimes on one file would
   * fight through the CAS/diff3 loop — the user loses either way). True when
   * the caller may proceed with its own open.
   */
  requestOpen: (from: PaneId, path: string) => boolean;
  /** Focus a pane (pointer landing in it, no open involved). */
  focus: (pane: PaneId) => void;
  /** The focused pane's live open-note state, or null until a pane registers
   * its store — an action fired in that window has no note to act on. */
  focusedState: () => OpenNoteState | null;
  registerStore: (pane: PaneId, store: OpenNoteStore | null) => void;
};

/**
 * The coordinator, owning the focus rules. Nothing here touches React, so
 * one-note-one-pane is unit-testable without a renderer.
 */
export function createPaneCoordinator(): PaneCoordinator {
  const openPaths = new Map<PaneId, string | null>();
  const stores = new Map<PaneId, OpenNoteStore>();
  const store = createStore<PaneFocus>()(() => ({ pane: "primary", path: null }));

  const publish = (pane: PaneId): void => {
    store.setState({ pane, path: openPaths.get(pane) ?? null });
  };

  return {
    store,
    openPath: (pane) => openPaths.get(pane) ?? null,
    focusedState: () => stores.get(store.getState().pane)?.state() ?? null,
    reportOpenPath: (pane, path) => {
      openPaths.set(pane, path);
      // A split whose note closed (deleted, vault switch) yields focus back.
      publish(pane === "split" && path === null ? "primary" : store.getState().pane);
    },
    requestOpen: (from, path) => {
      const other: PaneId = from === "primary" ? "split" : "primary";
      if (openPaths.get(other) === path && stores.has(other)) {
        publish(other);
        return false;
      }
      publish(from);
      return true;
    },
    focus: (pane) => {
      if (!stores.has(pane)) return;
      publish(pane);
    },
    registerStore: (pane, paneStore) => {
      if (paneStore !== null) {
        stores.set(pane, paneStore);
        return;
      }
      stores.delete(pane);
      openPaths.set(pane, null);
      const focused = store.getState().pane;
      publish(focused === pane ? "primary" : focused);
    },
  };
}
