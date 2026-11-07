// Keyed by the id of the item each editor holds, so a consumer never grabs a stale editor serving
// another item: opening another item mounts a new editor, and the outgoing one must stop answering
// for the incoming id.

import type { SlateEditor } from "platejs";

const editors = new Map<string, SlateEditor>();
// weak: a strong reverse map would pin every editor a session built.
const itemIds = new WeakMap<SlateEditor, string>();

export const registerLiveEditor = (itemId: string, editor: SlateEditor): (() => void) => {
  editors.set(itemId, editor);
  itemIds.set(editor, itemId);
  return () => {
    if (editors.get(itemId) === editor) {
      editors.delete(itemId);
    }
  };
};

export const getLiveEditor = (itemId: string): SlateEditor | null => editors.get(itemId) ?? null;

// the item an editor holds, kept after it unmounts: `getLiveEditor` says whether it still answers
export const liveEditorItemId = (editor: SlateEditor): string | null => itemIds.get(editor) ?? null;
