// ⌘T's target: the note title is pane chrome OUTSIDE the Plate tree, so the
// shortcut plugin reaches it through this single-slot registry (the
// agent-request shape; one pane mounts at a time).

let installed: (() => void) | null = null;

/** The mounted pane wires its title's scroll+focus here. Returns unregister. */
export function registerNoteTitleFocus(focus: () => void): () => void {
  installed = focus;
  return () => {
    if (installed === focus) installed = null;
  };
}

/** Focus the mounted note's title. False when no pane registered one. */
export function focusNoteTitle(): boolean {
  if (installed === null) return false;
  installed();
  return true;
}
