import { useCallback, useEffect, useRef } from "react";

import { Button } from "@repo/ui/components/button";

import { getBridge } from "@/renderer/lib/bridge";
import { useAgentStore } from "@/renderer/stores/agent-store";

export function OnboardingPage() {
  const appState = useAgentStore((s) => s.appState);
  const triggered = useRef(false);

  const setupError =
    appState.phase === "error" && appState.prev === "setting_up"
      ? appState.message
      : null;

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
          <p className="text-xs text-muted-foreground">Setting up...</p>
        )}
      </div>
    </div>
  );
}
