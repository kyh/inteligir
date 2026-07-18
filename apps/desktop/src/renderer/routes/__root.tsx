import { useEffect } from "react";
import { createRootRoute, Navigate, Outlet, useLocation } from "@tanstack/react-router";

import { ConfirmDialogHost } from "@repo/ui/components/confirm-dialog";
import { Toaster } from "@repo/ui/components/sonner";
import { TooltipProvider } from "@repo/ui/components/tooltip";
import { ReauthDialog } from "@renderer/components/reauth-dialog";
import { useAgentStore } from "@renderer/stores/agent-store";
import { useUiStateStore } from "@renderer/stores/ui-state-store";
import type { AppState } from "@repo/features/app-state";

export const Route = createRootRoute({ component: RootLayout });

type Phase = AppState["phase"];
type ErrorPrev = Extract<AppState, { phase: "error" }>["prev"];

// No login route: the app boots as a guest (#459). Pre-ready phases show the
// onboarding/setup surface (a brief splash on warm boots, the seeding
// progress on a first run); ready is the workspace. An error routes by its
// prev so a setup OR reset failure surfaces on the setup screen (with Retry)
// and an agent failure surfaces in the workspace banner.
function phaseToPath(phase: Phase | ErrorPrev): "/" | "/onboarding" {
  switch (phase) {
    case "starting":
    case "setting_up":
    case "resetting":
      return "/onboarding";
    case "ready":
    case "error":
      return "/";
  }
}

function RootLayout() {
  const appState = useAgentStore((s) => s.appState);
  const init = useAgentStore((s) => s.init);
  const initUiState = useUiStateStore((s) => s.init);
  const { pathname } = useLocation();

  useEffect(() => init(), [init]);
  useEffect(() => void initUiState(), [initUiState]);

  // Redirect during render (not in useEffect) so we never flash the wrong
  // route while the navigation runs after first paint.
  const target =
    appState.phase === "error" ? phaseToPath(appState.prev) : phaseToPath(appState.phase);
  const needsRedirect = pathname !== target;

  return (
    // One TooltipProvider for the whole app so every tooltip shares the same
    // delay behavior (web mounts the same provider in its root).
    <TooltipProvider>
      <div className="relative h-full w-full font-sans">
        <div className="flex h-full flex-col">
          {needsRedirect ? <Navigate to={target} replace /> : <Outlet />}
        </div>

        <ReauthDialog />
        {/* One shared confirm() dialog for the whole workspace. */}
        <ConfirmDialogHost />
        {/* App-wide toast outlet. */}
        <Toaster />
      </div>
    </TooltipProvider>
  );
}
