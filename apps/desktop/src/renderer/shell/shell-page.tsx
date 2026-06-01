import { useEffect } from "react";

import { BottomDock } from "@/renderer/shell/bottom-dock";
import { PanelGrid } from "@/renderer/shell/panel-grid";
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

  return (
    <div className="relative h-full w-full">
      {/* Draggable title strip — the native title bar is hidden. */}
      <div className="app-drag fixed inset-x-0 top-0 z-10 h-12" />

      {/* Greeting — top left. */}
      <div className="fixed top-3 left-4 z-20">
        <h1 className="text-sm font-medium text-foreground">{timeOfDayGreeting()}</h1>
      </div>

      {/* Date — top right. */}
      <div className="fixed top-3.5 right-4 z-20">
        <span className="text-xs text-muted-foreground">{todayLabel()}</span>
      </div>

      {/* Widget workspace. */}
      <div className="absolute inset-0 px-4 pt-14 pb-20">
        <PanelGrid />
      </div>

      <BottomDock />
    </div>
  );
}
