import { useEffect, useState } from "react";
import type { EditorPorts } from "@/editor/editor-ports";
import { readNote, readNoteComments } from "@/lib/app-runtime";
import { NOTE_GONE } from "./comment-ops";
import type { CommentOutcome } from "./comment-ops";
import type { CommentEdits } from "./comments-view";
import type { CommentsRead } from "./notes-store";

// the sheet is open on every thread of the note, or on the ones a tap in the page named
export interface SheetRequest {
  readonly ids: readonly string[] | null;
}

interface SheetComments {
  // null until the read for this opening answers
  readonly comments: CommentsRead | null;
  readonly edits: CommentEdits;
}

// the note's comments, folded against the markers its text holds now
const loadComments = async (path: string): Promise<CommentsRead> => {
  const read = await readNote(path);
  return read.ok ? await readNoteComments(read) : { message: read.message, ok: false };
};

// The comments sheet's threads, read each time it opens, and its edits. The request stays the
// screen's state: the editor's ports are made with the callback that opens the sheet, and these
// edits go through those same ports.
export const useSheetComments = (
  sheet: SheetRequest | null,
  opened: string | null,
  verbs: EditorPorts["comments"],
): SheetComments => {
  const [comments, setComments] = useState<CommentsRead | null>(null);

  useEffect(() => {
    if (sheet === null || opened === null) {
      return;
    }
    let live = true;
    void (async () => {
      const threads = await loadComments(opened);
      if (live) {
        setComments(threads);
      }
    })();
    return () => {
      live = false;
      setComments(null);
    };
  }, [sheet, opened]);

  // an edit is on the phone once it answers, so the sheet reads the store again in place rather
  // than going back to Loading under the field being typed in
  const editComments = async (
    change: (path: string) => Promise<CommentOutcome>,
  ): Promise<CommentOutcome> => {
    if (opened === null) {
      return { kind: "refused", message: NOTE_GONE };
    }
    const outcome = await change(opened);
    if (outcome.kind === "done") {
      setComments(await loadComments(opened));
    }
    return outcome;
  };
  const edits: CommentEdits = {
    reply: async (rootId, text) =>
      await editComments(async (notePath) => await verbs.reply(notePath, rootId, text)),
    remove: async (rootId) =>
      await editComments(async (notePath) => {
        const removed = await verbs.remove(notePath, rootId);
        return removed.kind === "done" ? { kind: "done" } : removed;
      }),
    resolve: async (rootId, resolved) =>
      await editComments(async (notePath) => await verbs.resolve(notePath, rootId, resolved)),
  };

  return { comments, edits };
};
