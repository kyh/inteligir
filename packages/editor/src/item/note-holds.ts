// Whether the open note holds every edit made here, which a host asks before it lets the note go.

import { deferred } from "@repo/editor/deferred";

import type { OpenNote } from "./item-editor";
import type { NoteHeld } from "./note-connection";

// the open note as a leave reads it: where it stands, without the document it binds
export type LeavingNote = Omit<OpenNote, "status"> & {
  readonly status: () =>
    | { readonly kind: "opening" | "missing" }
    | { readonly kind: "open"; readonly live: boolean; readonly held: NoteHeld | null };
};

// asked of a live note, which answers once it has stored them; a note whose socket goes down
// meanwhile answers by what reached it before, since an ask on a socket that is gone is never
// answered. A note that takes no edit holds all it can.
export const noteHolds = async (note: LeavingNote): Promise<boolean> => {
  const status = note.status();
  if (status.kind !== "open" || status.held !== null) {
    return true;
  }
  if (!status.live) {
    return !note.unsent();
  }
  const settled = deferred<boolean>();
  const stop = note.subscribe(() => {
    const now = note.status();
    if (now.kind !== "open" || now.held !== null) {
      settled.resolve(true);
    } else if (!now.live) {
      settled.resolve(!note.unsent());
    }
  });
  try {
    return await Promise.race([note.whenSaved(), settled.promise]);
  } finally {
    stop();
  }
};
