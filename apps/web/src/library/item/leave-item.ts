// CLAUDE.md § The tab asks before it loses the open item's edit: the open note is asked whether it
// stored every edit made here before the page leaves it, and an edit typed while no connection
// could carry it is given up only on the person's word.

import { noteHolds } from "@repo/editor/item/note-holds";
import type { LeavingNote } from "@repo/editor/item/note-holds";
import type { ConfirmOptions } from "@repo/ui/components/confirm-dialog";

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
