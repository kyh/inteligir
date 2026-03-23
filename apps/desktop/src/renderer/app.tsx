import { useEffect, useRef, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router";

import { GeometricOrb, type DisplayStatus } from "@repo/ui/geometric-orb";
import { MENU_ACTIONS } from "@/shared/ipc";
import { getBridge } from "@/renderer/lib/bridge";
import { useAgentStore } from "@/renderer/stores/agent-store";
import { useVoiceStore } from "@/renderer/stores/voice-store";

function phaseToOrbStatus(phase: string, voiceState: string): DisplayStatus {
  if (voiceState === "connected") return "listening";
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

  // Minimum time on onboarding page — separate effect to avoid loops
  const onboardingReadyRef = useRef(false);
  const [, forceUpdate] = useState(0);

  useEffect(() => init(), [init]);

  // Start the 5s timer when we navigate TO onboarding
  useEffect(() => {
    if (pathname === "/onboarding") {
      onboardingReadyRef.current = false;
      const timer = setTimeout(() => {
        onboardingReadyRef.current = true;
        forceUpdate((n) => n + 1);
      }, 5000);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [pathname]);

  useEffect(() => {
    const target = appState.phase === "error"
      ? phaseToPath(appState.prev)
      : phaseToPath(appState.phase);

    // Block leaving onboarding until 5s timer expires
    if (pathnameRef.current === "/onboarding" && target !== "/onboarding" && !onboardingReadyRef.current) {
      return;
    }

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

  // Voice store is initialized by ChatPage's useEffect(init). Before that,
  // sessionState defaults to "inactive" which maps to the agent-only status — safe.
  const voiceState = useVoiceStore((s) => s.sessionState);
  const orbStatus = phaseToOrbStatus(appState.phase, voiceState);

  const isSettings = pathname === "/settings";

  return (
    <div className="relative h-full w-full font-mono">
      {!isSettings && (
        <div className="pointer-events-none absolute inset-0 -z-10 grid place-items-center">
          <div className="h-48 w-48">
            <GeometricOrb status={orbStatus} />
          </div>
        </div>
      )}

      <div className="flex h-full flex-col">
        <Outlet />
      </div>
    </div>
  );
}
