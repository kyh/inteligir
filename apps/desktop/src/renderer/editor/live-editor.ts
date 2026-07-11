// The one seam that lets chrome OUTSIDE the Plate tree — the shell header's
// "Page details" popover — reach the mounted rich editor's live instance.
// Mirrors the transient-settle wire (ai/transient-settle.ts): the editor owns
// the registration, this module is just the map. Keyed by path so a consumer
// can never grab a stale editor serving some other note.

import type { SlateEditor } from "platejs";

const editors = new Map<string, SlateEditor>();

/** Wire a mounted rich editor's live instance: `path` is the vault-relative
 * file it serves. Returns the unregister function. */
export function registerLiveEditor(path: string, editor: SlateEditor): () => void {
  editors.set(path, editor);
  return () => {
    if (editors.get(path) === editor) editors.delete(path);
  };
}

/** The live editor mounted on `path`, or null when none is (raw mode, no
 * markdown note open, or a teardown race). */
export function getLiveEditor(path: string): SlateEditor | null {
  return editors.get(path) ?? null;
}
