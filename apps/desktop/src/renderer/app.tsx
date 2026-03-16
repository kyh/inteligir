import { useEffect, useRef } from "react";
import { Outlet, useLocation, useNavigate } from "react-router";

import { MENU_ACTIONS } from "@/shared/ipc";
import { getBridge } from "@/renderer/lib/bridge";
import { useAgentStore } from "@/renderer/stores/agent-store";

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
    const target = appState.phase === "error"
      ? phaseToPath(appState.prev)
      : phaseToPath(appState.phase);

    // Only navigate if we're not already on the right page
    // and don't navigate away from settings unless phase requires it
    if (pathnameRef.current === "/settings" && target === "/") return;
    if (pathnameRef.current !== target) {
      void navigate(target);
    }
  }, [appState, navigate]);

  // Cmd+, -> open settings
  useEffect(() => {
    const bridge = getBridge();
    if (!bridge) return;
    return bridge.onMenuAction((action) => {
      if (action === MENU_ACTIONS.OPEN_SETTINGS) {
        void navigate("/settings");
      }
    });
  }, [navigate]);

  return (
    <div className="flex h-full w-full flex-col font-mono">
      <Outlet />
    </div>
  );
}
