// The editor's ask of the split surface (#595): "open this note in the split
// pane". Same module-store discipline as agent-request — the app registers the
// action once at mount, and the wiki chip offers its menu item only while one
// is registered, so the editor package never imports the shell.

export interface SplitViewActions {
  /** Open `path` in the split pane (opening it if closed). */
  openInSplit: (path: string) => void;
}

let installed: SplitViewActions | null = null;
const listeners = new Set<() => void>();

export function setSplitViewActions(actions: SplitViewActions | null): void {
  installed = actions;
  for (const listener of listeners) listener();
}

export function splitViewActions(): SplitViewActions | null {
  return installed;
}

/** useSyncExternalStore-shaped subscription for the chip's menu item. */
export function subscribeSplitViewActions(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
