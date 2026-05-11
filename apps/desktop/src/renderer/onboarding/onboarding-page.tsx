import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@repo/ui/components/button";

import { getBridge } from "@/renderer/lib/bridge";
import { useAgentStore } from "@/renderer/stores/agent-store";
import type { VoiceModelStateEvent } from "@/shared/ipc";

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
  const triggered = useRef(false);
  const [modelState, setModelState] = useState<VoiceModelStateEvent | null>(null);

  const setupError =
    appState.phase === "error" && appState.prev === "setting_up" ? appState.message : null;

  // Auto-trigger setup on mount
  useEffect(() => {
    if (appState.phase === "logged_in" && !triggered.current) {
      triggered.current = true;
      getBridge()?.transition({ type: "SETUP" });
    }
  }, [appState.phase]);

  // Subscribe to model-download progress events so we can show progress
  // while seedResources/startAgent hold us in the setting_up phase.
  useEffect(() => {
    const bridge = getBridge();
    if (!bridge) return;
    return bridge.onVoiceModelState((event) => {
      setModelState(event);
    });
  }, []);

  const handleRetry = useCallback(() => {
    getBridge()?.transition({ type: "RETRY" });
  }, []);

  const modelLabel = modelStatusLabel(modelState);

  return (
    <div className="flex flex-1 flex-col items-center justify-end px-6 pb-16">
      <div className="flex w-full max-w-xs flex-col gap-3 text-center">
        {setupError ? (
          <>
            <p className="text-[10px] text-destructive">{setupError}</p>
            <Button
              variant="ghost"
              onClick={handleRetry}
              className="text-[10px] text-muted-foreground underline hover:text-foreground"
            >
              Retry
            </Button>
          </>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">
              {modelLabel ?? "Setting up..."}
            </p>
            {modelState?.status === "downloading" && (
              <div className="h-1 w-full overflow-hidden rounded-full bg-foreground/10">
                <div
                  className="h-full bg-foreground/40 transition-[width] duration-200"
                  style={{ width: `${String(modelState.percent)}%` }}
                />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
