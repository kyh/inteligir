import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@repo/ui/components/button";

import { InitialOrb } from "@renderer/components/initial-orb";
import { getBridge } from "@renderer/lib/bridge";
import { useAgentStore } from "@renderer/stores/agent-store";
import type { VoiceModelStateEvent } from "@repo/features/ipc-registry";

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function modelStatusLabel(state: VoiceModelStateEvent | null): string | null {
  if (!state) return null;
  switch (state.status) {
    case "downloading":
      return `Downloading speech model… ${String(state.percent)}% (${formatBytes(state.receivedBytes)} / ${formatBytes(state.totalBytes)})`;
    case "extracting":
      return "Extracting speech model…";
    case "ready":
      return null;
    case "error":
      return `Speech model failed: ${state.message}`;
    case "idle":
      return null;
  }
}

export function OnboardingPage() {
  const appState = useAgentStore((s) => s.appState);
  const setupProgress = useAgentStore((s) => s.setupProgress);
  const triggered = useRef(false);
  const [modelState, setModelState] = useState<VoiceModelStateEvent | null>(null);

  const setupError =
    appState.phase === "error" && appState.prev === "setting_up" ? appState.message : null;

  // First-run only: warm boots auto-fire SETUP host-side (initMachine) and
  // never linger in "starting" — a lingering "starting" means the workspace
  // has never been seeded, so this surface drives the setup and shows its
  // progress. Setup is a vault/workspace concern, not identity: the guest
  // lands in the workspace either way (#459).
  useEffect(() => {
    if (appState.phase === "starting" && !triggered.current) {
      triggered.current = true;
      getBridge().transition({ type: "SETUP" });
    }
  }, [appState.phase]);

  // Subscribe to model-download progress events so we can show progress
  // while seedResources/startAgent hold us in the setting_up phase.
  useEffect(() => {
    return getBridge().onVoiceModelState((event) => {
      setModelState(event);
    });
  }, []);

  const handleRetry = useCallback(() => {
    getBridge().transition({ type: "RETRY" });
  }, []);

  // Prefer the granular model-download progress when the voice model step is
  // active; otherwise fall back to the generic setup-step text + bar.
  const modelLabel = modelStatusLabel(modelState);
  const modelDownloading = modelState?.status === "downloading";
  const label = modelLabel ?? setupProgress?.step ?? "Setting up...";
  const percent = modelDownloading ? modelState.percent : (setupProgress?.percent ?? null);
  const isIndeterminate = percent === null;

  return (
    <div className="shell-dots flex flex-1 flex-col items-center justify-end px-6 pb-16">
      <InitialOrb />
      <div className="flex w-full max-w-xs flex-col gap-3 text-center">
        {setupError ? (
          <>
            <p className="text-[10px] text-destructive">{setupError}</p>
            <Button variant="ghost" size="sm" onClick={handleRetry} className="self-center">
              Retry
            </Button>
          </>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">{label}</p>
            {/* bg-muted ≈ canvas on the new ladder — use the overlay tint so
                the track stays visible on the dotted floor. */}
            <div className="h-1 w-full overflow-hidden rounded-full bg-foreground/10">
              <div
                className={
                  isIndeterminate
                    ? "h-full w-full animate-progress-fill bg-foreground/60"
                    : "h-full bg-foreground/60 transition-[width] duration-200 ease-out"
                }
                style={isIndeterminate ? undefined : { width: `${String(percent)}%` }}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
