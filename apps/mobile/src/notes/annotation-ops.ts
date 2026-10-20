// Each verb edits the note's annotation store by the rules the server runs
// (@repo/notes/annotations/annotation-threads). Platform-free: the scenario suite runs it under node.

import {
  addReply,
  addRoot,
  deleteAnnotation,
  editEntry,
} from "@repo/notes/annotations/annotation-threads";
import { mintAnnotationId } from "@repo/notes/annotations/store-schema";
import type { AnnotationEditOutcome, NotesStore } from "./notes-store";

export type AnnotationOutcome = { kind: "done" } | { kind: "refused"; message: string };

// `removedIds`: the annotation's root and every reply, whose markers the note may still hold
type AnnotationRemoval =
  | { kind: "done"; removedIds: readonly string[] }
  | Extract<AnnotationOutcome, { kind: "refused" }>;

export interface AnnotationOps {
  // a highlight: `anchor` is the note's text with the new annotation's markers, computed from
  // `expected`, and `quote` the passage's text; its entry starts with no note
  add: (args: {
    path: string;
    id: string;
    quote: string;
    anchor: { expected: string; content: string };
  }) => Promise<AnnotationEditOutcome>;
  // the note on an annotation, or a reply's text: a store write alone
  edit: (path: string, id: string, text: string) => Promise<AnnotationOutcome>;
  reply: (path: string, rootId: string, text: string) => Promise<AnnotationOutcome>;
  remove: (path: string, rootId: string) => Promise<AnnotationRemoval>;
}

export interface AnnotationOpsArgs {
  store: Pick<NotesStore, "editAnnotations">;
  // unix seconds, the store's unit
  now: () => number;
  // a reply's id
  randomBytes: (length: number) => Uint8Array;
}

export const NOTE_GONE = "This item is no longer on your phone.";

// an edit, a reply or a delete anchors nothing, so no text of the note is expected and none can
// have moved
const outcomeOf = (edited: AnnotationEditOutcome): AnnotationOutcome => {
  switch (edited.kind) {
    case "edited": {
      return { kind: "done" };
    }
    case "changed": {
      return { kind: "refused", message: "This item changed on your phone. Try again." };
    }
    case "vanished": {
      return { kind: "refused", message: NOTE_GONE };
    }
    case "refused": {
      return edited;
    }
    // no default
  }
};

export const createAnnotationOps = ({
  now,
  randomBytes,
  store,
}: AnnotationOpsArgs): AnnotationOps => ({
  add: async ({ anchor, id, path, quote }) =>
    await store.editAnnotations({
      anchor,
      edit: (entries) => addRoot(entries, { at: now(), id, quote, source: "user", text: "" }),
      path,
    }),

  edit: async (path, id, text) =>
    outcomeOf(
      await store.editAnnotations({
        anchor: null,
        edit: (entries) => editEntry(entries, { at: now(), id, source: "user", text }),
        path,
      }),
    ),

  remove: async (path, rootId) => {
    let removedIds: readonly string[] = [];
    const outcome = outcomeOf(
      await store.editAnnotations({
        anchor: null,
        edit: (entries) => {
          const deleted = deleteAnnotation(entries, rootId);
          if (deleted.ok) {
            ({ removedIds } = deleted);
          }
          return deleted;
        },
        path,
      }),
    );
    return outcome.kind === "done" ? { kind: "done", removedIds } : outcome;
  },

  reply: async (path, rootId, text) =>
    outcomeOf(
      await store.editAnnotations({
        anchor: null,
        edit: (entries) =>
          addReply(entries, {
            at: now(),
            id: mintAnnotationId(randomBytes),
            parentId: rootId,
            source: "user",
            text,
          }),
        path,
      }),
    ),
});
