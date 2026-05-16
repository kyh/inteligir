import { useEffect, useRef } from "react";
import { Outlet, useLocation, useNavigate } from "react-router";

import { GeometricOrb, type DisplayStatus } from "@repo/ui/components/geometric-orb";
import { useAgentStore } from "@/renderer/stores/agent-store";
import { useVoiceStore } from "@/renderer/stores/voice-store";

function phaseToOrbStatus(phase: string, listening: boolean): DisplayStatus {
  if (listening) return "listening";
  switch (phase) {
    case "ready":
      return "idle";
    case "error":
      return "error";
    default:
      return "starting";
  }
}

function phaseToPath(phase: string): "/" | "/login" | "/onboarding" {
  switch (phase) {
    case "logged_out":
    case "logging_in":
      return "/login";
    case "logged_in":
    case "setting_up":
      return "/onboarding";
    default:
      return "/";
  }
}

export function AppLayout() {
  const appState = useAgentStore((s) => s.appState);
  const init = useAgentStore((s) => s.init);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;

  useEffect(() => init(), [init]);

  useEffect(() => {
    const target =
      appState.phase === "error" ? phaseToPath(appState.prev) : phaseToPath(appState.phase);

    if (pathnameRef.current !== target) {
      void navigate(target);
    }
  }, [appState, navigate]);

  // Voice store is initialized by ChatPage's useEffect(init). Before that,
  // state.kind defaults to "idle" — orb falls back to the agent-only status.
  const listening = useVoiceStore((s) => s.state.kind === "listening");
  const orbStatus = phaseToOrbStatus(appState.phase, listening);

  return (
    <div className="relative h-full w-full font-mono">
      <div className="pointer-events-none absolute inset-0 -z-10 grid place-items-center">
        <div className="h-48 w-48">
          <GeometricOrb status={orbStatus} />
        </div>
      </div>

      <div className="flex h-full flex-col">
        <Outlet />
      </div>
    </div>
  );
}
