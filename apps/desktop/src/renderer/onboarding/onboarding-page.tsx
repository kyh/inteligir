import { useCallback, useEffect, useRef } from "react";

import { Button } from "@repo/ui/button";

import { GeometricOrb } from "@/renderer/components/geometric-orb";
import { getBridge } from "@/renderer/lib/bridge";
import { useAgentStore } from "@/renderer/stores/agent-store";

export function OnboardingPage() {
  const appState = useAgentStore((s) => s.appState);
  const triggered = useRef(false);

  const settingUp = appState.phase === "setting_up";
  const setupError = appState.phase === "error" && appState.prev === "setting_up"
    ? appState.message
    : null;

  const orbStatus = settingUp ? "busy" : setupError ? "error" : "idle";

  // Auto-trigger setup on mount
  useEffect(() => {
    if (appState.phase === "logged_in" && !triggered.current) {
      triggered.current = true;
      getBridge()?.transition({ type: "SETUP" });
    }
  }, [appState.phase]);

  const handleRetry = useCallback(() => {
    getBridge()?.transition({ type: "RETRY" });
  }, []);

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-0 px-6">
      <div className="h-48 w-48">
        <GeometricOrb status={orbStatus} />
      </div>

      <div className="flex max-w-xs flex-col gap-1 text-center">
        <h1 className="text-sm font-semibold">
          {setupError ? "Setup failed" : "Setting up Inteligir"}
        </h1>
        <p className="text-[10px] text-muted-foreground">
          {setupError
            ? "Something went wrong during setup."
            : "Preparing your workspace and installing tools..."}
        </p>
      </div>

      {setupError && (
        <div className="mt-4 flex max-w-xs flex-col gap-3">
          <p className="text-center text-[10px] text-destructive">{setupError}</p>
          <Button
            variant="ghost"
            onClick={handleRetry}
            className="text-[10px] text-muted-foreground underline hover:text-foreground"
          >
            Retry
          </Button>
        </div>
      )}
    </div>
  );
}
