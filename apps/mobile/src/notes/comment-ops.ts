// The phone's comment verbs over the notes store, each an edit of the note's comment store by the
// rules the server runs (@repo/notes/comments/comment-threads), signed as the user. A new comment
// is the editor page's: its markers are already in the note's text, which lands in the same change
// set as its entry. Platform-free: the scenario suite runs it under node.

import { addReply, addRoot, resolveThread } from "@repo/notes/comments/comment-threads";
import { mintCommentId } from "@repo/notes/comments/sidecar-schema";
import type { CommentEditOutcome, NotesStore } from "./notes-store";

export type CommentOutcome = { kind: "done" } | { kind: "refused"; message: string };

export interface CommentOps {
  // `anchor` is the note's text with the new comment's markers, computed from `expected`
  add: (args: {
    path: string;
    id: string;
    text: string;
    anchor: { expected: string; content: string };
  }) => Promise<CommentEditOutcome>;
  reply: (path: string, rootId: string, text: string) => Promise<CommentOutcome>;
  resolve: (path: string, rootId: string, resolved: boolean) => Promise<CommentOutcome>;
}

export interface CommentOpsArgs {
  store: Pick<NotesStore, "editComments">;
  // unix seconds, the store's unit
  now: () => number;
  // a reply's id
  randomBytes: (length: number) => Uint8Array;
}

const GONE = "This note is no longer on your phone.";

// a reply or a resolve anchors nothing, so no text of the note is expected and none can have moved
const outcomeOf = (edited: CommentEditOutcome): CommentOutcome => {
  switch (edited.kind) {
    case "edited": {
      return { kind: "done" };
    }
    case "changed": {
      return { kind: "refused", message: "This note changed on your phone. Try again." };
    }
    case "vanished": {
      return { kind: "refused", message: GONE };
    }
    case "refused": {
      return edited;
    }
    // no default
  }
};

export const createCommentOps = ({ now, randomBytes, store }: CommentOpsArgs): CommentOps => ({
  add: async ({ anchor, id, path, text }) =>
    await store.editComments({
      anchor,
      edit: (sidecar) => addRoot(sidecar, { at: now(), id, source: "user", text }),
      path,
    }),

  reply: async (path, rootId, text) =>
    outcomeOf(
      await store.editComments({
        anchor: null,
        edit: (sidecar) =>
          addReply(sidecar, {
            at: now(),
            id: mintCommentId(randomBytes),
            parentId: rootId,
            source: "user",
            text,
          }),
        path,
      }),
    ),

  resolve: async (path, rootId, resolved) =>
    outcomeOf(
      await store.editComments({
        anchor: null,
        edit: (sidecar) => resolveThread(sidecar, { at: now(), by: "user", resolved, rootId }),
        path,
      }),
    ),
});
