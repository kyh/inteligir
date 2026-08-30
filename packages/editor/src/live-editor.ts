// The one seam that lets chrome OUTSIDE the Plate tree — the right panel's
// Properties and Comments tabs — edit the live document, and the one that
// answers the reverse question for a keyboard handler: which note is this
// editor serving? A plugin's onKeyDown runs outside React holding only the
// editor, so the note it must act on is the one ITS editor mounted for. The
// mounted editor owns both registrations; this module is just the map. Keyed
// by path so a consumer can never grab a stale editor serving some other note
// — a note switch mounts a new editor, and the outgoing one must stop
// answering for the incoming note's path.

import type { SlateEditor } from "platejs";

const editors = new Map<string, SlateEditor>();
// Weak on purpose: an unmounted editor is garbage the moment the document
// drops it, and a strong reverse map would pin every editor a session built.
const paths = new WeakMap<SlateEditor, string>();

/** Wire a mounted rich editor's live instance: `path` is the vault-relative
 * file it serves. Returns the unregister function, which only clears an entry
 * this registration still owns. */
export function registerLiveEditor(path: string, editor: SlateEditor): () => void {
  editors.set(path, editor);
  paths.set(editor, path);
  return () => {
    if (editors.get(path) === editor) editors.delete(path);
  };
}

/** The live editor mounted on `path`, or null when none is (raw mode, no
 * markdown note open, or a teardown race). */
export function getLiveEditor(path: string): SlateEditor | null {
  return editors.get(path) ?? null;
}

/** The note `editor` was mounted for — the only identity a non-React caller
 * holding just the editor has. Null for an unregistered (headless) mount. */
export function liveEditorPath(editor: SlateEditor): string | null {
  return paths.get(editor) ?? null;
}
