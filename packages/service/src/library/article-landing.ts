// A page's article lands with the write that brings it, a fill's landing or a device's save of a
// page. An item whose note writes its body refuses that write (`note-opened`), so the article goes
// in the note, outside any transaction, and the write lands again with the body the note answered.
// The note replaces once by the sequence the write met the item at, so a page sent again replaces
// nothing twice, and one read again since replaces anew.

import type { LibraryBlock } from "@repo/contract/library/library-nodes";

import type { NoteProjection, NoteReach } from "../note/note-wire";
import type { CellResult } from "./cell-refusal";

// what the note took: the item and the body as it now projects
export interface ArticleInNote {
  readonly itemId: string;
  readonly projection: NoteProjection;
}

export const landArticle = async <T>(
  notes: NoteReach,
  article: readonly LibraryBlock[],
  land: (inNote: ArticleInNote | null) => CellResult<T>,
): Promise<CellResult<T>> => {
  const first = land(null);
  if (first.ok || first.refusal.kind !== "note-opened") {
    return first;
  }
  const { itemId, seq } = first.refusal;
  const reply = await notes(itemId).replaceArticle(article, `article:${itemId}:${seq}`);
  return reply.kind === "applied" ? land({ itemId, projection: reply.projection }) : first;
};
