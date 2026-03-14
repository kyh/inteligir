import { useEffect } from "react";
import { Outlet, useNavigate } from "react-router";

import { MENU_ACTIONS } from "@/shared/ipc";
import { getBridge } from "@/renderer/lib/bridge";
import { useAgentStore } from "@/renderer/stores/agent-store";

export function AppLayout() {
  const needsSetup = useAgentStore((s) => s.needsSetup);
  const init = useAgentStore((s) => s.init);
  const navigate = useNavigate();

  useEffect(() => init(), [init]);

  // Auto-navigate to onboarding when no API keys configured
  useEffect(() => {
    if (needsSetup) void navigate("/onboarding");
  }, [needsSetup, navigate]);

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
