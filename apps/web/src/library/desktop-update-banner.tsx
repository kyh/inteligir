import { Progress } from "@repo/ui/components/progress";
import { toast } from "@repo/ui/components/sonner";
import { DownloadIcon, RotateCwIcon } from "lucide-react";
import { useEffect } from "react";
import type { ReactNode } from "react";

import { moveUpdate, useDesktopUpdates } from "./desktop-updates";
import type { UpdateMove } from "./desktop-updates";
import type { DesktopUpdateState } from "./shell/desktop-bridge";

const ID = "desktop-update";

const step = ({
  icon,
  move,
}: {
  readonly icon?: ReactNode;
  readonly move?: { readonly label: string; readonly move: UpdateMove };
}) => ({
  action:
    move === undefined
      ? undefined
      : {
          label: move.label,
          onClick: (event: { preventDefault: () => void }) => {
            event.preventDefault();
            void moveUpdate(move.move);
          },
        },
  dismissible: false,
  duration: Number.POSITIVE_INFINITY,
  icon,
  id: ID,
});

const say = (state: DesktopUpdateState | null) => {
  switch (state?.status) {
    case "available": {
      toast("Update available", {
        ...step({
          icon: <DownloadIcon className="size-4" />,
          move: { label: "Download", move: "download" },
        }),
        description: `Inteligir ${state.version} is ready to download.`,
      });

      return;
    }

    case "downloading": {
      toast.loading("Downloading the update", {
        ...step({}),
        description: (
          <>
            {`${String(state.downloadPercent)}% complete`}
            <Progress
              className="mt-2"
              value={state.downloadPercent}
              aria-label="Download progress"
            />
          </>
        ),
      });

      return;
    }

    case "downloaded": {
      toast("Update ready", {
        ...step({
          icon: <RotateCwIcon className="size-4" />,
          move: { label: "Restart", move: "install" },
        }),
        description: `Restart to finish installing Inteligir ${state.version}.`,
      });

      return;
    }

    case "download-failed": {
      toast.error("The download didn't go through", {
        ...step({ move: { label: "Try again", move: "download" } }),
        description: state.message,
      });

      return;
    }

    case "install-failed": {
      toast.error("The update didn't install", {
        ...step({ move: { label: "Try again", move: "install" } }),
        description: state.message,
      });

      return;
    }

    default: {
      toast.dismiss(ID);
    }
  }
};

export const DesktopUpdateBanner = () => {
  const state = useDesktopUpdates();
  useEffect(() => {
    say(state);
  }, [state]);

  return null;
};
