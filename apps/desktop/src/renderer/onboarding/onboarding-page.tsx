import { useEffect } from "react";
import { useNavigate } from "react-router";

import { Button } from "@repo/ui/button";

import { GeometricOrb } from "@/renderer/components/geometric-orb";
import { useLogin } from "@/renderer/lib/use-login";
import { useAgentStore } from "@/renderer/stores/agent-store";

export function OnboardingPage() {
  const navigate = useNavigate();
  const { login, loggingIn, loginError } = useLogin();
  const needsSetup = useAgentStore((s) => s.needsSetup);
  const sessionStatus = useAgentStore((s) => s.sessionStatus);

  useEffect(() => {
    if (!needsSetup) void navigate("/");
  }, [needsSetup, navigate]);

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-0 px-6">
      <div className="h-48 w-48">
        <GeometricOrb status={sessionStatus} />
      </div>

      <div className="flex max-w-xs flex-col gap-1 text-center">
        <h1 className="text-sm font-semibold">Welcome to Inteligir</h1>
        <p className="text-[10px] text-muted-foreground">
          Log in with your OpenAI account to get started.
        </p>
      </div>

      <div className="mt-6 flex w-full max-w-xs flex-col gap-3">
        <Button
          onClick={login}
          disabled={loggingIn}
          className="w-full text-xs"
        >
          {loggingIn ? "Waiting for browser..." : "Log in with OpenAI"}
        </Button>
        {loginError && (
          <p className="text-center text-[10px] text-destructive">
            {loginError}
          </p>
        )}
        <p className="text-center text-[10px] text-muted-foreground/60">
          Opens your browser to sign in with OpenAI.
        </p>
      </div>
    </div>
  );
}
