// The Mac app's update, said in one toast the root keeps up while there is something to do about
// it: nothing downloads or restarts without the person's click. A tab has no updater and shows none.

import { useEffect } from "react";
import { toast } from "@repo/ui/components/sonner";

import { moveUpdate, useDesktopUpdates } from "./desktop-updates";

const UPDATE_NOTICE = "desktop-update";
const STAYS = { duration: Number.POSITIVE_INFINITY, id: UPDATE_NOTICE } as const;

export const UpdateNotice = () => {
  const state = useDesktopUpdates();
  useEffect(() => {
    switch (state?.status) {
      case "available": {
        toast.info(`Inteligir ${state.version} is available.`, {
          ...STAYS,
          action: {
            label: "Download",
            onClick: () => {
              void moveUpdate("download");
            },
          },
        });
        return;
      }
      case "downloading": {
        toast.loading(`Downloading the update — ${String(state.downloadPercent)}%`, {
          ...STAYS,
          action: undefined,
        });
        return;
      }
      case "downloaded": {
        toast.success(`Inteligir ${state.version} is ready.`, {
          ...STAYS,
          action: {
            label: "Restart",
            onClick: () => {
              void moveUpdate("install");
            },
          },
          description: "Restart to finish installing it.",
        });
        return;
      }
      case "error": {
        toast.error("The update didn't go through.", {
          ...STAYS,
          action: {
            label: "Try again",
            onClick: () => {
              void moveUpdate("check");
            },
          },
          description: state.message,
        });
        return;
      }
      default: {
        toast.dismiss(UPDATE_NOTICE);
      }
    }
  }, [state]);
  return null;
};
