import { HOLDS_ANSWER_MS } from "@repo/client/note-bodies";
import { deferred } from "@repo/contract/deferred";
import type { OpenNote } from "@repo/editor/item/item-editor";
import { confirm } from "@repo/ui/components/confirm-dialog";
import type { ConfirmOptions } from "@repo/ui/components/confirm-dialog";
import { useEffect } from "react";
import type { RefObject } from "react";

import { usePageLibrary } from "../cloud/library-context";
import type { TabSession } from "../cloud/library-context";
import { guardLeaves } from "../library-history";

const holdsInTime = async (note: Pick<OpenNote, "holds">) => {
  const late = deferred<false>();

  const timer = setTimeout(() => {
    late.resolve(false);
  }, HOLDS_ANSWER_MS);

  try {
    return await Promise.race([note.holds(), late.promise]);
  } finally {
    clearTimeout(timer);
  }
};

export const leaveItem = async (
  note: Pick<OpenNote, "holds"> | null,
  ask: (options: ConfirmOptions) => Promise<boolean>,
) => {
  if (note === null || (await holdsInTime(note))) {
    return true;
  }

  return await ask({
    body: "Some of what you typed hasn't saved yet. Leave now and it's lost.",
    cancelLabel: "Stay",
    confirmLabel: "Leave anyway",
    destructive: true,
    title: "Leave without saving?",
  });
};

export const unloadAsks = (note: Pick<OpenNote, "unloadLoses"> | null, session: TabSession) =>
  session.kind === "live" && note !== null && note.unloadLoses();

export const useLeaveItem = (note: RefObject<OpenNote | null>) => {
  const { session } = usePageLibrary();
  useEffect(() => {
    const asksOnUnload = (event: BeforeUnloadEvent) => {
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
