// Keyed by the id of the item each editor holds, so a consumer never grabs a stale editor serving
// another item: opening another item mounts a new editor, and the outgoing one must stop answering
// for the incoming id.

import type { SlateEditor } from "platejs";

const editors = new Map<string, SlateEditor>();
// weak: a strong reverse map would pin every editor a session built.
const itemIds = new WeakMap<SlateEditor, string>();
const waiting = new Map<string, Set<(editor: SlateEditor) => void>>();

export const registerLiveEditor = (itemId: string, editor: SlateEditor): (() => void) => {
  editors.set(itemId, editor);
  itemIds.set(editor, itemId);
  for (const run of waiting.get(itemId) ?? []) {
    run(editor);
  }
  waiting.delete(itemId);
  return () => {
    if (editors.get(itemId) === editor) {
      editors.delete(itemId);
    }
  };
};

export const getLiveEditor = (itemId: string): SlateEditor | null => editors.get(itemId) ?? null;

// runs `run` once with the editor answering for the item: now, or as one first answers, which an
// item's editor does only once its note has synced; the answer stops the wait
export const onLiveEditor = (itemId: string, run: (editor: SlateEditor) => void): (() => void) => {
  const editor = editors.get(itemId);
  if (editor !== undefined) {
    run(editor);
    return () => {
      // it already ran
    };
  }
  const runs = waiting.get(itemId) ?? new Set();
  runs.add(run);
  waiting.set(itemId, runs);
  return () => {
    runs.delete(run);
    if (runs.size === 0 && waiting.get(itemId) === runs) {
      waiting.delete(itemId);
    }
  };
};

// the item an editor holds, kept after it unmounts: `getLiveEditor` says whether it still answers
export const liveEditorItemId = (editor: SlateEditor): string | null => itemIds.get(editor) ?? null;
