// ⌘T's target: the note title lives OUTSIDE the Plate tree, so the shortcut
// plugin reaches it through this registry. Keyed by the note's path because
// that is how ⌘T is ROUTED — the pressed editor names its own note
// (live-editor) and the title it focuses has to be that note's, so a title
// registered for some other file answers nothing rather than scrolling the
// wrong document. A miss is the honest "no title here" the shortcut needs to
// fall through on.
// Deliberately NOT a subscribable store: nothing renders from it, and the
// CAS-guarded unregister (only the registration that installed an entry may
// clear it) is what survives StrictMode's mount/unmount/mount.

const installed = new Map<string, () => void>();

/** The mounted title wires its own scroll+focus here, under the note it is
 * showing. Returns unregister. */
export function registerNoteTitleFocus(path: string, focus: () => void): () => void {
  installed.set(path, focus);
  return () => {
    if (installed.get(path) === focus) installed.delete(path);
  };
}

/** Focus the title showing `path`. False when none is mounted for it. */
export function focusNoteTitle(path: string | null): boolean {
  const focus = path === null ? undefined : installed.get(path);
  if (focus === undefined) return false;
  focus();
  return true;
}
