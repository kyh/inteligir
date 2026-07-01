import { useEffect } from "react";
import { Navigate, Outlet, useLocation } from "react-router";

import { Toaster } from "@repo/ui/components/sonner";
import { ReauthDialog } from "@/renderer/components/reauth-dialog";
import { useAgentStore } from "@/renderer/stores/agent-store";
import { useUiStateStore } from "@/renderer/stores/ui-state-store";
import type { AppState } from "@/shared/app-state";

type Phase = AppState["phase"];

function phaseToPath(phase: Phase): "/" | "/login" | "/onboarding" {
  switch (phase) {
    case "logged_out":
    case "logging_in":
      return "/login";
    case "logged_in":
    case "setting_up":
      return "/onboarding";
    case "ready":
    case "logging_out":
    case "error":
      return "/";
  }
}

export function AppLayout() {
  const appState = useAgentStore((s) => s.appState);
  const init = useAgentStore((s) => s.init);
  const initUiState = useUiStateStore((s) => s.init);
  const { pathname } = useLocation();

  useEffect(() => init(), [init]);
  useEffect(() => void initUiState(), [initUiState]);

  // Redirect during render (not in useEffect) so we never flash the wrong
  // route while the navigation effect runs after first paint.
  const target =
    appState.phase === "error" ? phaseToPath(appState.prev) : phaseToPath(appState.phase);
  const needsRedirect = pathname !== target;

  return (
    <div className="relative h-full w-full font-sans">
      <div className="flex h-full flex-col">
        {needsRedirect ? <Navigate to={target} replace /> : <Outlet />}
      </div>

      <ReauthDialog />
      {/* Desktop toasts join the smoked-glass overlay language. */}
      <Toaster glass />
    </div>
  );
}
