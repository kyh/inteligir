// CLAUDE.md § THE TAB ASKS BEFORE IT LOSES THE OPEN ITEM'S EDIT: the open note is asked whether it
// stored every edit made here before the page leaves it, and an edit typed while no connection
// could carry it is given up only on the person's word.

import { deferred } from "@repo/editor/deferred";
import type { OpenNote } from "@repo/editor/item/item-editor";
import type { NoteHeld } from "@repo/editor/item/note-connection";
import type { ConfirmOptions } from "@repo/ui/components/confirm-dialog";

// the open note as a leave reads it: where it stands, without the document it binds
type LeavingNote = Omit<OpenNote, "status"> & {
  readonly status: () =>
    | { readonly kind: "opening" | "missing" }
    | { readonly kind: "open"; readonly live: boolean; readonly held: NoteHeld | null };
};

// whether the note holds every edit made here: asked of a live note, which answers once it has
// stored them; a note whose socket goes down meanwhile answers by what reached it before, since an
// ask on a socket that is gone is never answered. A note that takes no edit holds all it can.
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

// whether the page may leave the item
export const leaveItem = async (
  note: LeavingNote | null,
  ask: (options: ConfirmOptions) => Promise<boolean>,
): Promise<boolean> => {
  if (note === null || (await noteHolds(note))) {
    return true;
  }
  return await ask({
    body: "Some of what you typed here hasn't reached your library, since there's no connection. Leave now and it's lost.",
    cancelLabel: "Stay",
    confirmLabel: "Discard edits",
    destructive: true,
    title: "Leave without saving?",
  });
};
