import { useCallback } from "react";

import { Button } from "@repo/ui/components/button";

import { InitialOrb } from "@renderer/components/initial-orb";
import { getBridge } from "@renderer/lib/bridge";
import { useAgentStore } from "@renderer/stores/agent-store";

export function LoginPage() {
  const appState = useAgentStore((s) => s.appState);

  const loggingIn = appState.phase === "logging_in";
  const loginError =
    appState.phase === "error" && appState.prev === "logging_in" ? appState.message : null;

  const handleLogin = useCallback(() => {
    getBridge()?.transition({ type: "LOGIN" });
  }, []);

  const handleRetry = useCallback(() => {
    getBridge()?.transition({ type: "RETRY" });
  }, []);

  return (
    <div className="shell-dots flex flex-1 flex-col items-center justify-end px-6 pb-16">
      <InitialOrb />
      <div className="flex w-full max-w-xs flex-col gap-3">
        <Button
          onClick={loginError ? handleRetry : handleLogin}
          disabled={loggingIn}
          className="w-full text-xs"
        >
          {loginError ? "Retry" : loggingIn ? "Waiting..." : "Log in with OpenAI"}
        </Button>
      </div>
    </div>
  );
}
