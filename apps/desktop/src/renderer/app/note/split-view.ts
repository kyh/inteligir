// Split-view plumbing shared between the provider and the panes (#595): the
// pane vocabulary, the coordinator that enforces one-note-one-pane, and the
// imperative handle the workspace reads at action time (view context, export,
// comment create all act on the FOCUSED pane).

import type { OpenNoteState, OpenNoteStore } from "@repo/editor/note/open-note-store";
import { createContext } from "react";

export type PaneId = "primary" | "split";

export type PaneCoordinator = {
  /** Live open paths per pane (refs, read at action time). */
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
  focus: (pane: PaneId) => void;
  focusedPane: () => PaneId;
  registerStore: (pane: PaneId, store: OpenNoteStore | null) => void;
};

/** What the workspace may ask imperatively (a ref, not a subscription). */
export type VaultPanesHandle = {
  /** The focused pane's live open-note state. */
  focusedState: () => OpenNoteState;
  focusedPane: () => PaneId;
  /** Focus a pane (pointer landing in it, no open involved). */
  focus: (pane: PaneId) => void;
};

export const PaneInfraContext = createContext<PaneCoordinator | null>(null);

/**
 * The coordinator, pure over its callback: `onFocusChange` fires with the
 * focused pane + that pane's open path after every state move. Extracted from
 * the provider so one-note-one-pane is unit-testable without React.
 */
export function createPaneCoordinator(
  onFocusChange: (pane: PaneId, path: string | null) => void,
): PaneCoordinator & { store: (pane: PaneId) => OpenNoteStore | null } {
  const openPaths = new Map<PaneId, string | null>();
  const stores = new Map<PaneId, OpenNoteStore | null>();
  let focused: PaneId = "primary";

  const publish = (): void => {
    onFocusChange(focused, openPaths.get(focused) ?? null);
  };

  return {
    store: (pane) => stores.get(pane) ?? null,
    focusedPane: () => focused,
    openPath: (pane) => openPaths.get(pane) ?? null,
    reportOpenPath: (pane, path) => {
      openPaths.set(pane, path);
      // A split whose note closed (deleted, vault switch) yields focus back.
      if (pane === "split" && path === null) focused = "primary";
      publish();
    },
    requestOpen: (from, path) => {
      const other: PaneId = from === "primary" ? "split" : "primary";
      if (openPaths.get(other) === path && (stores.get(other) ?? null) !== null) {
        focused = other;
        publish();
        return false;
      }
      focused = from;
      publish();
      return true;
    },
    focus: (pane) => {
      if ((stores.get(pane) ?? null) === null) return;
      focused = pane;
      publish();
    },
    registerStore: (pane, store) => {
      stores.set(pane, store);
      if (store === null) {
        openPaths.set(pane, null);
        if (focused === pane) focused = "primary";
        publish();
      }
    },
  };
}
