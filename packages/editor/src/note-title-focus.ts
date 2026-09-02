// the note title lives outside the Plate tree, so ⌘T reaches it here, keyed by path
// so the pressed editor focuses its own note's title and no other. not a subscribable
// store: nothing renders from it. the cas-guarded unregister survives StrictMode's mount/unmount/mount.

const installed = new Map<string, () => void>();

export function registerNoteTitleFocus(path: string, focus: () => void): () => void {
  installed.set(path, focus);
  return () => {
    if (installed.get(path) === focus) installed.delete(path);
  };
}

export function focusNoteTitle(path: string | null): boolean {
  const focus = path === null ? undefined : installed.get(path);
  if (focus === undefined) return false;
  focus();
  return true;
}
