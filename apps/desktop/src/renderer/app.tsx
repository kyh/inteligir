import { useEffect, useRef, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router";

import { MENU_ACTIONS } from "@/shared/ipc";
import { GeometricOrb } from "@/renderer/components/geometric-orb";
import { getBridge } from "@/renderer/lib/bridge";
import { useAgentStore } from "@/renderer/stores/agent-store";
import { useVoiceStore } from "@/renderer/stores/voice-store";
import type { DisplayStatus } from "@/shared/agent";

function phaseToOrbStatus(phase: string, voiceState: string): DisplayStatus {
  if (voiceState === "listening") return "listening";
  if (voiceState === "speaking") return "speaking";
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

  // Minimum time on onboarding page
  const [onboardingReady, setOnboardingReady] = useState(false);
  const onboardingTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => init(), [init]);

  useEffect(() => {
    const target = appState.phase === "error"
      ? phaseToPath(appState.prev)
      : phaseToPath(appState.phase);

    // Start timer when entering onboarding
    if (target === "/onboarding" && pathnameRef.current !== "/onboarding") {
      setOnboardingReady(false);
      onboardingTimerRef.current = setTimeout(
        () => setOnboardingReady(true),
        5000,
      );
    }

    // Block leaving onboarding until timer expires
    if (pathnameRef.current === "/onboarding" && target !== "/onboarding" && !onboardingReady) {
      return;
    }

    if (pathnameRef.current === "/settings" && target === "/") return;
    if (pathnameRef.current !== target) {
      void navigate(target);
    }
  }, [appState, navigate, onboardingReady]);

  useEffect(() => {
    return () => clearTimeout(onboardingTimerRef.current);
  }, []);

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

  const voiceState = useVoiceStore((s) => s.sessionState);
  const orbStatus = phaseToOrbStatus(appState.phase, voiceState);

  return (
    <div className="relative h-full w-full font-mono">
      <div className={`pointer-events-none absolute inset-0 -z-10 grid place-items-center ${pathname === "/settings" ? "hidden" : ""}`}>
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
