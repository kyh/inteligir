import { Button } from "@repo/ui/components/button";
import type { DesktopUpdateState } from "../shell/desktop-bridge";
import { moveUpdate, useDesktopUpdates } from "../desktop-updates";
import type { UpdateMove } from "../desktop-updates";
import { Row } from "./settings-chrome";

interface RowWords {
  readonly status: string;
  readonly button: { readonly label: string; readonly move: UpdateMove } | null;
}

const CHECK = { label: "Check for updates", move: "check" } as const;

const rowWords = (state: DesktopUpdateState) => {
  switch (state.status) {
    case "idle": {
      return {
        button: CHECK,
        status: "Inteligir checks for updates when it opens.",
      } satisfies RowWords;
    }

    case "checking": {
      return { button: null, status: "Checking…" } satisfies RowWords;
    }

    case "not-available": {
      return { button: CHECK, status: "Inteligir is up to date." } satisfies RowWords;
    }

    case "available": {
      return {
        button: { label: "Download", move: "download" },
        status: `Inteligir ${state.version} is ready to download.`,
      } satisfies RowWords;
    }

    case "downloading": {
      return {
        button: null,
        status: `Downloading the update — ${String(state.downloadPercent)}%`,
      } satisfies RowWords;
    }

    case "downloaded": {
      return {
        button: { label: "Restart to update", move: "install" },
        status: `Inteligir ${state.version} installs when it restarts.`,
      } satisfies RowWords;
    }

    case "check-failed": {
      return { button: CHECK, status: "Inteligir couldn't check for updates." } satisfies RowWords;
    }

    case "download-failed": {
      return {
        button: { label: "Try again", move: "download" },
        status: `Inteligir ${state.version} didn't download.`,
      } satisfies RowWords;
    }

    case "install-failed": {
      return {
        button: { label: "Try again", move: "install" },
        status: `Inteligir ${state.version} didn't install.`,
      } satisfies RowWords;
    }

    default: {
      throw new Error(`unexpected ${String(state satisfies never)}`);
    }
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
      {"message" in state ? (
        <span className="mt-1 block text-body text-destructive">{state.message}</span>
      ) : null}
    </Row>
  );
};
