import { useCallback, useEffect } from "react";

import { Button } from "@repo/ui/components/button";

import { getBridge } from "@/renderer/lib/bridge";
import { BottomDock } from "@/renderer/shell/bottom-dock";
import { LeftDock } from "@/renderer/shell/left-dock";
import { PanelGrid } from "@/renderer/shell/panel-grid";
import { useAgentStore } from "@/renderer/stores/agent-store";
import { useVoiceStore } from "@/renderer/stores/voice-store";

// ---------------------------------------------------------------------------
// Greeting / date helpers
// ---------------------------------------------------------------------------

function timeOfDayGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function todayLabel(): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date());
}

// ---------------------------------------------------------------------------
// Chat page (home)
// ---------------------------------------------------------------------------

export function ShellPage() {
  const initVoice = useVoiceStore((s) => s.init);
  useEffect(() => initVoice(), [initVoice]);

  // The app machine routes error states back to the route of the phase they
  // came from (app.tsx); for prev "ready"/"logging_out" that's the shell,
  // which has no page-level error UI of its own — surface the message and the
  // RETRY affordance here. RETRY re-runs SETUP (prev "ready") or LOGOUT
  // (prev "logging_out") in the main-process machine.
  const appState = useAgentStore((s) => s.appState);
  const shellError =
    appState.phase === "error" && (appState.prev === "ready" || appState.prev === "logging_out")
      ? appState.message
      : null;

  const handleRetry = useCallback(() => {
    getBridge()?.transition({ type: "RETRY" });
  }, []);

  return (
    <div className="relative h-full w-full">
      {/* Draggable title strip — the native title bar is hidden. */}
      <div className="app-drag fixed inset-x-0 top-0 z-10 h-12" />

      {/* Greeting — top left, clearing the macOS traffic lights
          (hiddenInset title bar, controls at x: 16). */}
      <div className="fixed top-3 left-28 z-20">
        <h1 className="text-[13px] leading-4 font-normal text-[rgba(19,20,27,0.45)]">
          {timeOfDayGreeting()}
        </h1>
      </div>

      {/* Date — top right. */}
      <div className="fixed top-3.5 right-8 z-20">
        <span className="text-[13px] leading-4 text-[rgba(19,20,27,0.4)] tabular-nums">
          {todayLabel()}
        </span>
      </div>

      {/* Machine error banner — recoverable failures (agent restart /
          logout) that landed back on the shell route. */}
      {shellError !== null && (
        <div className="fixed inset-x-0 top-14 z-30 flex justify-center px-20">
          {/* Smoked-glass pill; destructive text on dark glass uses the
              light salmon (#ffb4ab) for contrast, Retry is a glass-row pill. */}
          <div className="glass-smoke-deep flex max-w-xl items-center gap-3 rounded-full px-3 py-1.5">
            <span className="truncate text-xs text-[#ffb4ab]" title={shellError}>
              {shellError}
            </span>
            <Button
              size="xs"
              variant="ghost"
              className="shrink-0 bg-glass-row text-glass-fg hover:bg-glass-row-hover hover:text-glass-fg"
              onClick={handleRetry}
            >
              Retry
            </Button>
          </div>
        </div>
      )}

      {/* Widget workspace. Left padding clears the vertical LeftDock; the
          shell-dots canvas (styles.css) aligns its lattice to this element's
          content box, which is the panel grid's origin. */}
      <div className="shell-dots absolute inset-0 pt-16 pr-8 pb-28 pl-28">
        <PanelGrid />
      </div>

      <LeftDock />
      <BottomDock />
    </div>
  );
}
