import { useEffect, useRef } from "react";
import { Outlet, useLocation, useNavigate } from "react-router";

import { MENU_ACTIONS } from "@/shared/ipc";
import { getBridge } from "@/renderer/lib/bridge";
import { useAgentStore } from "@/renderer/stores/agent-store";

const SETUP_PATHS = new Set(["/login", "/onboarding"]);

export function AppLayout() {
  const setupChecked = useAgentStore((s) => s.setupChecked);
  const needsLogin = useAgentStore((s) => s.needsLogin);
  const needsOnboarding = useAgentStore((s) => s.needsOnboarding);
  const init = useAgentStore((s) => s.init);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;

  useEffect(() => init(), [init]);

  useEffect(() => {
    if (!setupChecked) return;
    if (needsLogin) {
      void navigate("/login");
    } else if (needsOnboarding) {
      void navigate("/onboarding");
    } else if (SETUP_PATHS.has(pathnameRef.current)) {
      void navigate("/");
    }
  }, [setupChecked, needsLogin, needsOnboarding, navigate]);

  // Cmd+, → open settings
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
