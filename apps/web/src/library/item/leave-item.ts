// CLAUDE.md § The tab asks before it loses the open item's edit. The open item rides the URL, so
// every way off it is guarded: a move the tab makes and Back or Forward through the address's
// history (`library-history.ts`), and the tab's close or reload through the browser's own ask. The
// open note is asked whether it stored every edit made here, and an edit typed while no connection
// could carry it is given up only on the person's word.

import type { OpenNote } from "@repo/editor/item/item-editor";
import { confirm } from "@repo/ui/components/confirm-dialog";
import type { ConfirmOptions } from "@repo/ui/components/confirm-dialog";
import { useEffect } from "react";
import type { RefObject } from "react";

import { usePageLibrary } from "../cloud/library-context";
import type { TabSession } from "../cloud/library-context";
import { guardLeaves } from "../library-history";

// whether the page may leave the item
export const leaveItem = async (
  note: Pick<OpenNote, "holds"> | null,
  ask: (options: ConfirmOptions) => Promise<boolean>,
): Promise<boolean> => {
  if (note === null || (await note.holds())) {
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

// whether the browser asks as the tab closes or reloads, where no dialog of the page's can: only
// over typing no connection carried, and never once the session ended, which leaves nothing the
// tab could still send
export const unloadAsks = (note: Pick<OpenNote, "unsent"> | null, session: TabSession): boolean =>
  session.kind === "live" && note !== null && note.unsent();

// guards the open note for as long as the workspace is mounted; every question is asked as a leave
// happens, so it reads the note the ref holds then
export const useLeaveItem = (note: RefObject<OpenNote | null>): void => {
  const { session } = usePageLibrary();
  useEffect(() => {
    const asksOnUnload = (event: BeforeUnloadEvent): void => {
      if (unloadAsks(note.current, session.get())) {
        event.preventDefault();
      }
    };
    window.addEventListener("beforeunload", asksOnUnload);
    const release = guardLeaves({
      holdsWork: () => note.current?.unsaved() === true,
      mayLeave: async () => await leaveItem(note.current, confirm),
    });
    return () => {
      window.removeEventListener("beforeunload", asksOnUnload);
      release();
    };
  }, [note, session]);
};
