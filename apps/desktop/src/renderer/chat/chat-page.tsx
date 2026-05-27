import { useEffect } from "react";
import { ListTodoIcon, PlugIcon, SettingsIcon, SparklesIcon } from "lucide-react";

import { ExtensionsPanel } from "@/renderer/chat/extensions-panel";
import { SettingsPanel } from "@/renderer/chat/settings-panel";
import { SkillsPanel } from "@/renderer/chat/skills-panel";
import { TaskPanel } from "@/renderer/chat/task-panel";
import { BottomDock, type DockPanel } from "@/renderer/chat/bottom-dock";
import { PanelGrid } from "@/renderer/chat/panel-grid";
import { DraggablePanel } from "@/renderer/components/draggable-panel";
import { useDiskState } from "@/renderer/lib/use-disk-state";
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

const OPEN_PANELS_KEY = "open-panels";
const DEFAULT_OPEN: Record<DockPanel, boolean> = {
  tasks: false,
  skills: false,
  extensions: false,
  settings: false,
};

export function ChatPage() {
  const initVoice = useVoiceStore((s) => s.init);
  useEffect(() => initVoice(), [initVoice]);

  const newSession = useAgentStore((s) => s.newSession);

  const [open, setOpen] = useDiskState<Record<DockPanel, boolean>>(
    OPEN_PANELS_KEY,
    DEFAULT_OPEN,
  );

  const togglePanel = (panel: DockPanel) =>
    setOpen((prev) => ({ ...prev, [panel]: !prev[panel] }));
  const closePanel = (panel: DockPanel) =>
    setOpen((prev) => ({ ...prev, [panel]: false }));

  return (
    <div className="relative h-full w-full">
      {/* Draggable title strip — the native title bar is hidden. */}
      <div className="app-drag fixed inset-x-0 top-0 z-10 h-12" />

      {/* Greeting — sits to the right of the docked logo orb. */}
      <div className="fixed top-3 left-[118px] z-20">
        <h1 className="text-sm font-medium text-foreground">{timeOfDayGreeting()}</h1>
      </div>

      {/* Date — top right. */}
      <div className="fixed top-3.5 right-4 z-20">
        <span className="text-xs text-muted-foreground">{todayLabel()}</span>
      </div>

      {/* Panel workspace. */}
      <div className="absolute inset-0 px-4 pt-14 pb-20">
        <PanelGrid />
      </div>

      <BottomDock panels={open} onTogglePanel={togglePanel} onNewSession={() => void newSession()} />

      {/* Utility overlays. */}
      <DraggablePanel
        title="Tasks"
        icon={<ListTodoIcon className="size-3.5" />}
        isOpen={open.tasks}
        onClose={() => closePanel("tasks")}
        initialPosition={{ x: 320, y: 80 }}
        initialSize={{ width: 320, height: 400 }}
      >
        <TaskPanel />
      </DraggablePanel>

      <DraggablePanel
        title="Skills"
        icon={<SparklesIcon className="size-3.5" />}
        isOpen={open.skills}
        onClose={() => closePanel("skills")}
        initialPosition={{ x: 320, y: 80 }}
        initialSize={{ width: 360, height: 480 }}
      >
        <SkillsPanel />
      </DraggablePanel>

      <DraggablePanel
        title="Extensions"
        icon={<PlugIcon className="size-3.5" />}
        isOpen={open.extensions}
        onClose={() => closePanel("extensions")}
        initialPosition={{ x: 320, y: 80 }}
        initialSize={{ width: 360, height: 480 }}
      >
        <ExtensionsPanel />
      </DraggablePanel>

      <DraggablePanel
        title="Settings"
        icon={<SettingsIcon className="size-3.5" />}
        isOpen={open.settings}
        onClose={() => closePanel("settings")}
        initialPosition={{ x: 320, y: 80 }}
        initialSize={{ width: 360, height: 320 }}
        minHeight={120}
      >
        <SettingsPanel />
      </DraggablePanel>
    </div>
  );
}
