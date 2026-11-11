// A page's article bound for an item whose note opened goes in the note first, outside any
// transaction, once per reading or save by its id, and the write that follows lands with what the
// note answered; a note that opened between the look and the write is tried once more, by the
// note. A fill's landing and a device's save of a page both land this way.

import type { LibraryBlock } from "@repo/contract/library/library-nodes";

import type { NoteProjection, NoteReach } from "../note/note-wire";
import type { CellResult } from "./cell-refusal";

// the note an article goes to, and the id its replacement is made once by
export interface NoteArticle {
  readonly itemId: string;
  readonly article: readonly LibraryBlock[];
  readonly onceId: string;
}

// what the note took: the item and the body as it now projects
export interface ArticleInNote {
  readonly itemId: string;
  readonly projection: NoteProjection;
}

export const articleThenLand = async <T>(
  notes: NoteReach,
  step: {
    readonly target: () => NoteArticle | null;
    readonly land: (inNote: ArticleInNote | null) => CellResult<T>;
  },
): Promise<CellResult<T>> => {
  const once = async (): Promise<CellResult<T>> => {
    const target = step.target();
    if (target === null) {
      return step.land(null);
    }
    const reply = await notes(target.itemId).replaceArticle(target.article, target.onceId);
    return step.land(
      reply.kind === "applied" ? { itemId: target.itemId, projection: reply.projection } : null,
    );
  };
  const first = await once();
  return !first.ok && first.refusal.kind === "note-opened" ? await once() : first;
};
