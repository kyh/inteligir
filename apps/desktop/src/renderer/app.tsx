import { useEffect } from "react";
import { Navigate, Outlet, useLocation } from "react-router";

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
  const { pathname } = useLocation();

  useEffect(() => init(), [init]);

  // Voice store is initialized by ChatPage's useEffect(init). Before that,
  // state.kind defaults to "idle" — orb falls back to the agent-only status.
  const listening = useVoiceStore((s) => s.state.kind === "listening");
  const orbStatus = phaseToOrbStatus(appState.phase, listening);

  // Redirect during render (not in useEffect) so we never flash the wrong
  // route while the navigation effect runs after first paint.
  const target =
    appState.phase === "error" ? phaseToPath(appState.prev) : phaseToPath(appState.phase);
  const needsRedirect = pathname !== target;

  return (
    <div className="relative h-full w-full font-mono">
      <div className="pointer-events-none absolute inset-0 -z-10 grid place-items-center">
        <div className="h-48 w-48">
          <GeometricOrb status={orbStatus} />
        </div>
      </div>

      <div className="flex h-full flex-col">
        {needsRedirect ? <Navigate to={target} replace /> : <Outlet />}
      </div>
    </div>
  );
}
