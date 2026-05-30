import { useEffect } from "react";
import { Navigate, Outlet, useLocation } from "react-router";
import { motion } from "motion/react";

import { GeometricOrb, type DisplayStatus } from "@repo/ui/components/geometric-orb";
import { Toaster } from "@repo/ui/components/sonner";
import { cn } from "@repo/ui/lib/utils";
import { useTheme } from "@/renderer/lib/use-theme";
import { useAgentStore } from "@/renderer/stores/agent-store";
import { useUiStateStore } from "@/renderer/stores/ui-state-store";
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
  const initUiState = useUiStateStore((s) => s.init);
  const { pathname } = useLocation();

  const { resolved } = useTheme();

  useEffect(() => init(), [init]);
  useEffect(() => void initUiState(), [initUiState]);

  // Voice store is initialized by ShellPage's useEffect(init). Before that,
  // state.kind defaults to "idle" — orb falls back to the agent-only status.
  const listening = useVoiceStore((s) => s.state.kind === "listening");
  const orbStatus = phaseToOrbStatus(appState.phase, listening);

  // Once the agent is ready the orb retires to the top-left corner and lives
  // there as the app's logo (matching where a logo sits on a regular site).
  // During login/onboarding it stays centered and large.
  const docked = appState.phase === "ready";

  // Redirect during render (not in useEffect) so we never flash the wrong
  // route while the navigation effect runs after first paint.
  const target =
    appState.phase === "error" ? phaseToPath(appState.prev) : phaseToPath(appState.phase);
  const needsRedirect = pathname !== target;

  return (
    <div className="relative h-full w-full font-mono">
      <motion.div
        layout
        transition={{ type: "spring", stiffness: 130, damping: 22 }}
        className={cn(
          "pointer-events-none fixed z-30",
          docked ? "top-2.5 left-[76px] h-8 w-8" : "inset-0 m-auto h-44 w-44",
        )}
      >
        <GeometricOrb status={orbStatus} baseColor={resolved === "dark" ? "#eeeeee" : "#0a0a0a"} />
      </motion.div>

      <div className="flex h-full flex-col">
        {needsRedirect ? <Navigate to={target} replace /> : <Outlet />}
      </div>

      <Toaster />
    </div>
  );
}
