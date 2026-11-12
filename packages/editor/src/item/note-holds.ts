// Whether the open note holds every edit made here, which a host asks before it lets the note go.

import { deferred } from "@repo/contract/deferred";

import type { OpenNote } from "./item-editor";
import type { NoteStatus } from "./note-connection";

type Undocumented<S> = S extends { readonly doc: unknown } ? Omit<S, "doc"> : S;

// the open note as a leave reads it: where it stands, without the document it binds
export type LeavingNote = Pick<OpenNote, "subscribe" | "whenSaved"> & {
  readonly status: () => Undocumented<NoteStatus>;
};

// What the status alone says of a leave, or null while only the note's answer can: a note that
// takes no edit holds all it can, and one with no connection holds all but what was typed then.
const settledBy = (status: Undocumented<NoteStatus>): boolean | null => {
  if (status.kind !== "open") {
    return true;
  }
  switch (status.edits.kind) {
    case "live": {
      return null;
    }
    case "offline": {
      return !status.unsent;
    }
    case "held":
    case "refused": {
      return true;
    }
    // no default
  }
};

// asked of a live note, which answers once it has stored them; a note whose socket goes down
// meanwhile answers by what reached it before, since an ask on a socket that is gone is never
// answered
export const noteHolds = async (note: LeavingNote): Promise<boolean> => {
  const now = settledBy(note.status());
  if (now !== null) {
    return now;
  }
  const settled = deferred<boolean>();
  const stop = note.subscribe(() => {
    const next = settledBy(note.status());
    if (next !== null) {
      settled.resolve(next);
    }
  });
  try {
    return await Promise.race([note.whenSaved(), settled.promise]);
  } finally {
    stop();
  }
};
