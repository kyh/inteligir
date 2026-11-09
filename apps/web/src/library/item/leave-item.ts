// CLAUDE.md § THE TAB ASKS BEFORE IT LOSES THE OPEN ITEM'S EDIT: the open item is written before
// it goes, and an edit no write will take is given up only on the person's word.

import type { ItemSession } from "@repo/editor/item/item-session";
import type { ConfirmOptions } from "@repo/ui/components/confirm-dialog";

// whether the page may leave the item
export const leaveItem = async (
  session: Pick<ItemSession, "flush" | "status"> | null,
  ask: (options: ConfirmOptions) => Promise<boolean>,
): Promise<boolean> => {
  await session?.flush();
  const status = session?.status();
  if (status?.kind !== "open" || !status.unsaved || status.failure === null) {
    return true;
  }
  return await ask({
    body: status.failure,
    cancelLabel: "Stay",
    confirmLabel: "Discard edits",
    destructive: true,
    title: "Leave without saving?",
  });
};
