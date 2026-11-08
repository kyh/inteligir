import { Button } from "@repo/ui/components/button";
import type { DesktopUpdateState } from "../../shell/desktop-bridge";
import { moveUpdate, useDesktopUpdates } from "../desktop-updates";
import type { UpdateMove } from "../desktop-updates";
import { Row } from "./settings-chrome";

interface RowWords {
  readonly status: string;
  readonly button: { readonly label: string; readonly move: UpdateMove } | null;
}

const CHECK = { label: "Check for updates", move: "check" } as const;

const rowWords = (state: DesktopUpdateState): RowWords => {
  switch (state.status) {
    case "idle": {
      return { button: CHECK, status: "Inteligir checks for updates when it opens." };
    }
    case "checking": {
      return { button: null, status: "Checking…" };
    }
    case "not-available": {
      return { button: CHECK, status: "Inteligir is up to date." };
    }
    case "available": {
      return {
        button: { label: "Download", move: "download" },
        status: `Inteligir ${state.version} is ready to download.`,
      };
    }
    case "downloading": {
      return { button: null, status: `Downloading the update — ${String(state.downloadPercent)}%` };
    }
    case "downloaded": {
      return {
        button: { label: "Restart to update", move: "install" },
        status: `Inteligir ${state.version} installs when it restarts.`,
      };
    }
    case "error": {
      return { button: CHECK, status: "The last update didn't go through." };
    }
    // no default
  }
};

export const UpdatesRow = () => {
  const state = useDesktopUpdates();

  if (state === null) {
    return (
      <Row label="Updates">
        <span className="text-subtitle text-muted-foreground">Updates come with the Mac app.</span>
      </Row>
    );
  }

  const { button, status } = rowWords(state);
  return (
    <Row label="Updates">
      <span className="flex items-center gap-2">
        {button === null ? null : (
          <Button
            variant="tertiary"
            size="compact"
            onClick={() => {
              void moveUpdate(button.move);
            }}
          >
            {button.label}
          </Button>
        )}
        <span className="text-subtitle text-muted-foreground">{status}</span>
      </span>
      {state.status === "error" ? (
        <span className="mt-1 block text-body text-destructive">{state.message}</span>
      ) : null}
    </Row>
  );
};
