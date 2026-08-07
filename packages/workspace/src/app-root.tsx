import { StrictMode, useEffect } from "react";

import { ConfirmDialogHost } from "@repo/ui/components/confirm-dialog";
import { Toaster } from "@repo/ui/components/sonner";
import { TooltipProvider } from "@repo/ui/components/tooltip";
import { ErrorBoundary } from "@repo/workspace/components/error-boundary";
import { ReauthDialog } from "@repo/workspace/components/reauth-dialog";
import { DesktopThemeProvider } from "@repo/workspace/lib/use-theme";
import { OnboardingPage } from "@repo/workspace/onboarding/onboarding-page";
import { useAgentStore } from "@repo/workspace/stores/agent-store";
import { installVoiceNarration } from "@repo/workspace/voice/narration";
import { useUiStateStore } from "@repo/workspace/stores/ui-state-store";
import { WorkspacePage } from "@repo/workspace/workspace/workspace-page";
import type { AppState } from "@repo/bridge/app-state";
import "./styles/globals.css";

type Phase = AppState["phase"];
type ErrorPrev = Extract<AppState, { phase: "error" }>["prev"];

// The route is already signed in, so the pre-ready phases are a boot splash:
// the client opens on `starting` and leaves it the moment the host's hydration
// push lands. `ready` is the workspace. An error routes by its prev, so a setup
// failure surfaces on the splash (with Retry) and a failure after ready
// surfaces in the workspace banner.
function phaseSurface(phase: Phase | ErrorPrev): "workspace" | "onboarding" {
  switch (phase) {
    case "starting":
    case "setting_up":
      return "onboarding";
    case "ready":
    case "error":
      return "workspace";
  }
}

function RootLayout() {
  const appState = useAgentStore((s) => s.appState);
  const init = useAgentStore((s) => s.init);
  const initUiState = useUiStateStore((s) => s.init);

  useEffect(() => init(), [init]);
  useEffect(() => void initUiState(), [initUiState]);
  // Voice's own wiring into chat — the chat store does not know voice exists.
  useEffect(() => installVoiceNarration(), []);

  const surface =
    appState.phase === "error" ? phaseSurface(appState.prev) : phaseSurface(appState.phase);

  return (
    // One TooltipProvider for the whole app so every tooltip shares the same
    // delay behavior (web mounts the same provider in its root).
    <TooltipProvider>
      <div className="relative h-full w-full font-sans">
        <div className="flex h-full flex-col">
          {surface === "onboarding" ? <OnboardingPage /> : <WorkspacePage />}
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

/** The entire product UI. Hosts call `installBridge(...)` before rendering
 * this — the app itself never touches a transport. */
export function App() {
  return (
    <StrictMode>
      <ErrorBoundary>
        <DesktopThemeProvider>
          <RootLayout />
        </DesktopThemeProvider>
      </ErrorBoundary>
    </StrictMode>
  );
}
