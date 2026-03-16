import { useCallback, useEffect, useState } from "react";

import { Button } from "@repo/ui/button";

import type { SessionStatus } from "@/shared/agent";
import { GeometricOrb } from "@/renderer/components/geometric-orb";
import { getBridge } from "@/renderer/lib/bridge";
import { useAgentStore } from "@/renderer/stores/agent-store";

export function OnboardingPage() {
  const checkSetup = useAgentStore((s) => s.checkSetup);
  const [status, setStatus] = useState<SessionStatus>("starting");
  const [error, setError] = useState<string | null>(null);

  const runSetup = useCallback(async () => {
    const bridge = getBridge();
    if (!bridge) return;

    setStatus("starting");
    setError(null);

    const result = await bridge.runSetup();
    if (result.ok) {
      setStatus("idle");
      checkSetup();
    } else {
      setStatus("error");
      setError(result.error);
    }
  }, [checkSetup]);

  // Auto-run setup on mount
  useEffect(() => {
    void runSetup();
  }, [runSetup]);

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-0 px-6">
      <div className="h-48 w-48">
        <GeometricOrb status={status} />
      </div>

      <div className="flex max-w-xs flex-col gap-1 text-center">
        <h1 className="text-sm font-semibold">
          {status === "error" ? "Setup failed" : "Setting up Inteligir"}
        </h1>
        <p className="text-[10px] text-muted-foreground">
          {status === "error"
            ? "Something went wrong during setup."
            : "Preparing your workspace and installing tools..."}
        </p>
      </div>

      {status === "error" && error && (
        <div className="mt-4 flex max-w-xs flex-col gap-3">
          <p className="text-center text-[10px] text-destructive">{error}</p>
          <Button
            variant="ghost"
            onClick={() => void runSetup()}
            className="text-[10px] text-muted-foreground underline hover:text-foreground"
          >
            Retry
          </Button>
        </div>
      )}
    </div>
  );
}
