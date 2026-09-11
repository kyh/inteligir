import { useState } from "react";
import { Button } from "@repo/ui/components/button";
import { updateAction } from "../../../update-state";
import type { UpdateAction, UpdateState } from "../../../update-state";
import { runUpdateAction, useDesktopUpdates } from "../desktop-updates";
import { failed, Row } from "./settings-chrome";

const statusLabel = (state: UpdateState): string => {
  switch (state.status) {
    case "disabled": {
      return state.message ?? "Automatic updates are off.";
    }
    case "idle": {
      return "Checked automatically a few minutes after launch, then every few minutes.";
    }
    case "checking": {
      return "Checking…";
    }
    case "up-to-date": {
      return `Inteligir ${state.currentVersion} is the newest version.`;
    }
    case "available": {
      return `Inteligir ${state.availableVersion ?? ""} is available.`;
    }
    case "downloading": {
      return `Downloading — ${state.downloadPercent ?? 0}%`;
    }
    case "downloaded": {
      return `Inteligir ${state.downloadedVersion ?? ""} is ready. Restart to finish.`;
    }
    case "error": {
      return "The last step failed.";
    }
    // no default
  }
};

const actionLabel = (action: UpdateAction, state: UpdateState): string => {
  switch (action) {
    case "check": {
      return "Check for updates";
    }
    case "download": {
      return `Download ${state.availableVersion ?? "update"}`;
    }
    case "install": {
      return "Restart to update";
    }
    // no default
  }
};

export const UpdatesRow = () => {
  const updates = useDesktopUpdates();
  const [pending, setPending] = useState(false);

  if (updates.kind === "no-bridge") {
    return (
      <Row label="Updates">
        <span className="text-subtitle text-muted-foreground">
          Automatic updates come with the desktop app.
        </span>
      </Row>
    );
  }
  if (updates.kind === "loading") {
    return <Row label="Updates">…</Row>;
  }

  const { state } = updates;
  const action = updateAction(state);

  const run = async (next: UpdateAction): Promise<void> => {
    setPending(true);
    try {
      await runUpdateAction(next);
    } catch (error) {
      failed(error, "The updater did not answer.");
    }
    setPending(false);
  };

  return (
    <Row label="Updates">
      <span className="flex items-center gap-2">
        {action === null ? null : (
          <Button
            variant="tertiary"
            size="compact"
            disabled={pending}
            onClick={() => {
              void run(action);
            }}
          >
            {actionLabel(action, state)}
          </Button>
        )}
        <span className="text-subtitle text-muted-foreground">{statusLabel(state)}</span>
      </span>
      {state.status === "error" && state.message !== null ? (
        <span className="mt-1 block text-body text-destructive">{state.message}</span>
      ) : null}
    </Row>
  );
};
