// ⌘T's target: the note title is pane chrome OUTSIDE the Plate tree, so the
// shortcut plugin reaches it through this registry. Keyed by the note's path
// because a split view mounts two titles and one note lives in one pane, so
// the path names the pane — a single slot would hand ⌘T to whichever pane
// mounted last, and go dead entirely when that pane closed.
// Deliberately NOT a subscribable store: nothing renders from it, and the
// CAS-guarded unregister (only the pane that registered an entry may clear it)
// is what survives StrictMode's mount/unmount/mount.

const installed = new Map<string, () => void>();

/** The mounted pane wires its title's scroll+focus here, under the note it is
 * showing. Returns unregister. */
export function registerNoteTitleFocus(path: string, focus: () => void): () => void {
  installed.set(path, focus);
  return () => {
    if (installed.get(path) === focus) installed.delete(path);
  };
}

/** Focus the title of the pane showing `path`. False when no pane is. */
export function focusNoteTitle(path: string | null): boolean {
  const focus = path === null ? undefined : installed.get(path);
  if (focus === undefined) return false;
  focus();
  return true;
}
