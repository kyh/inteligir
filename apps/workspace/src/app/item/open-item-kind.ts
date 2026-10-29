// What the open item is, read from the bytes the note store last held clean: they move on a load
// from disk and a save's settle, never per keystroke, so the stage never swaps under typing. A
// file that is no doc opens with no buffer, and its kind is its extension's. The answer holds
// through a moment with nothing loaded (a fill's rename being followed by the item's id), so a
// pending stub's placeholder never blinks into the editor.

import type { OpenNoteStore } from "@repo/editor/note/open-note-store";
import type { OpenEditorState } from "@repo/editor/vault-editor";
import { isItemStub, itemFactsOf } from "@repo/notes/items/item-frontmatter";
import type { ItemFacts } from "@repo/notes/items/item-frontmatter";
import { fileKindOf } from "@repo/notes/items/item-kind";
import type { ItemKind } from "@repo/notes/items/item-kind";
import { isDocPath } from "@repo/notes/knowledge/doc-file";
import { useState } from "react";
import { useStore } from "zustand";

export interface OpenItem {
  readonly path: string;
  readonly kind: ItemKind;
  // a doc's facts; null for a file that is no doc
  readonly facts: ItemFacts | null;
  readonly pending: boolean;
  // the original a viewer shows when the open path is the file itself
  readonly bareFile: string | null;
}

export const openItemOf = (path: string, content: string): OpenItem => {
  if (!isDocPath(path)) {
    return { bareFile: path, facts: null, kind: fileKindOf(path) ?? "file", path, pending: false };
  }
  const facts = itemFactsOf(content);
  return { bareFile: null, facts, kind: facts.kind, path, pending: isItemStub(facts) };
};

// null while nothing is open, or while an item just opened has not loaded yet
export const useOpenItem = (store: OpenNoteStore): OpenItem | null => {
  const openPath = useStore(store.store, (state) => state.openPath);
  // the buffer while it holds no edit: a dirty one keeps the answer the last clean bytes gave
  const clean = useStore(store.store, (state) =>
    state.editor.kind === "open" && !state.editor.dirty ? state.editor : null,
  );
  const [held, setHeld] = useState<{ item: OpenItem; from: OpenEditorState | string } | null>(null);
  if (openPath !== null && !isDocPath(openPath)) {
    if (held?.from !== openPath) {
      setHeld({ from: openPath, item: openItemOf(openPath, "") });
    }
  } else if (clean !== null && held?.from !== clean) {
    setHeld({ from: clean, item: openItemOf(clean.path, clean.content) });
  }
  return held !== null && openPath !== null && held.item.path === openPath ? held.item : null;
};
