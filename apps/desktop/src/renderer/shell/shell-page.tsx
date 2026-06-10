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
      <div className="fixed top-3 left-20 z-20">
        <h1 className="text-sm font-medium text-foreground">{timeOfDayGreeting()}</h1>
      </div>

      {/* Date — top right. */}
      <div className="fixed top-3.5 right-4 z-20">
        <span className="text-xs text-muted-foreground">{todayLabel()}</span>
      </div>

      {/* Machine error banner — recoverable failures (agent restart /
          logout) that landed back on the shell route. */}
      {shellError !== null && (
        <div className="fixed inset-x-0 top-14 z-30 flex justify-center px-20">
          <div className="flex max-w-xl items-center gap-3 rounded-md border border-destructive/40 bg-background/90 px-3 py-1.5 shadow-sm backdrop-blur">
            <span className="truncate text-xs text-destructive" title={shellError}>
              {shellError}
            </span>
            <Button size="xs" variant="outline" className="shrink-0" onClick={handleRetry}>
              Retry
            </Button>
          </div>
        </div>
      )}

      {/* Widget workspace. Left padding clears the vertical LeftDock. */}
      <div className="absolute inset-0 pt-14 pr-4 pb-24 pl-20">
        <PanelGrid />
      </div>

      <LeftDock />
      <BottomDock />
    </div>
  );
}
