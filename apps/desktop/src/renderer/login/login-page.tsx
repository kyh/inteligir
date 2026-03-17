import { useCallback, useState } from "react";

import { Button } from "@repo/ui/button";

import { GeometricOrb } from "@/renderer/components/geometric-orb";
import { getBridge } from "@/renderer/lib/bridge";
import { useAgentStore } from "@/renderer/stores/agent-store";
import type { SessionStatus } from "@/shared/agent";

const ORB_STATUSES: SessionStatus[] = ["idle", "busy", "error", "starting"];

export function LoginPage() {
  const appState = useAgentStore((s) => s.appState);

  const loggingIn = appState.phase === "logging_in";
  const loginError =
    appState.phase === "error" && appState.prev === "logging_in"
      ? appState.message
      : null;

  const [debugStatus, setDebugStatus] = useState<SessionStatus>("starting");
  const cycleStatus = useCallback(() => {
    setDebugStatus((prev) => {
      const idx = ORB_STATUSES.indexOf(prev);
      return ORB_STATUSES[(idx + 1) % ORB_STATUSES.length];
    });
  }, []);

  const handleLogin = useCallback(() => {
    getBridge()?.transition({ type: "LOGIN" });
  }, []);

  const handleRetry = useCallback(() => {
    getBridge()?.transition({ type: "RETRY" });
  }, []);

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-0 px-6">
      <div className="h-48 w-48">
        <GeometricOrb status={debugStatus} />
      </div>

      <div className="mt-6 flex w-full max-w-xs flex-col gap-3">
        <Button
          onClick={loginError ? handleRetry : handleLogin}
          disabled={loggingIn}
          className="w-full text-xs"
        >
          {loginError ? "Retry" : loggingIn ? "Waiting..." : "Log in"}
        </Button>
        <Button
          variant="outline"
          onClick={cycleStatus}
          className="w-full text-xs"
        >
          Orb: {debugStatus}
        </Button>
      </div>
    </div>
  );
}
