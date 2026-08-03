// A held sync pass is the app's quietest failure mode: the whole plan is
// refused, so this device's PUSHES stop too, and the only surface that reports
// it — Settings → Sync — is mounted solely while that dialog is open. Sync is
// off by default and the gate is tuned to fire rarely, which makes silence the
// wrong default exactly once: on the pass that matters.
//
// Fires on the TRANSITION into `held`, never on every held pass. The periodic
// reconcile re-holds on its own cadence and would otherwise turn this into a
// metronome; a pass that runs and holds again (a `syncing` phase in between)
// is a fresh answer to a question the user just asked, so that one does speak.

import { useEffect, useRef } from "react";

import { toast } from "@repo/ui/components/sonner";

import { getBridge } from "@renderer/lib/bridge";
import { useViewStore } from "@renderer/stores/view-store";
import type { SyncStatus } from "@repo/notes/sync/status";

/** Mounted once inside the workspace: announces a newly held sync pass and
 * routes to the section that can release it. */
export function useSyncHoldToast(): void {
  const lastPhase = useRef<SyncStatus["phase"] | null>(null);

  useEffect(() => {
    const announce = (status: SyncStatus): void => {
      const previous = lastPhase.current;
      lastPhase.current = status.phase;
      if (status.phase !== "held" || previous === "held") return;
      const { deletions, baseCount } = status;
      toast.warning(
        `Sync paused — ${deletions} of ${baseCount} synced file${baseCount === 1 ? "" : "s"} would be deleted.`,
        {
          description:
            "Nothing was deleted or uploaded, and this device will not sync again until you decide.",
          duration: Number.POSITIVE_INFINITY,
          closeButton: true,
          action: {
            label: "Review",
            onClick: () => useViewStore.getState().setSettingsOpen(true),
          },
        },
      );
    };
    // Hydrate once: a hold raised by the boot pass, or surviving a renderer
    // reload, would otherwise stay silent until the next periodic pass — the
    // whole time this device is not pushing.
    void getBridge()
      .getSyncState()
      .then((state) => announce(state.status))
      .catch(() => undefined);
    return getBridge().onSyncStateChanged((state) => announce(state.status));
  }, []);
}
