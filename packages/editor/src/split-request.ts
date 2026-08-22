// The editor's ask of the split surface (#595): "open this note in the split
// pane". Same store discipline as agent-request — the app registers the
// action once at mount, and the wiki chip offers its menu item only while one
// is registered, so the editor package never imports the shell.

import { create } from "zustand";

export interface SplitViewActions {
  /** Open `path` in the split pane (opening it if closed). */
  openInSplit: (path: string) => void;
}

type SplitViewState = { actions: SplitViewActions | null };

/** Subscribe with a selector: `useSplitViewActions((s) => s.actions)`. */
export const useSplitViewActions = create<SplitViewState>()(() => ({ actions: null }));

export function setSplitViewActions(actions: SplitViewActions | null): void {
  useSplitViewActions.setState({ actions });
}
