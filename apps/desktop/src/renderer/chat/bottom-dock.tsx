import {
  ListTodoIcon,
  MicIcon,
  PhoneIcon,
  PlugIcon,
  PlusIcon,
  SettingsIcon,
} from "lucide-react";

import { cn } from "@repo/ui/lib/utils";
import { useVoiceStore } from "@/renderer/stores/voice-store";

export type DockPanel = "tasks" | "extensions" | "settings";

type DockButtonProps = {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  className?: string;
};

function DockButton({
  icon: Icon,
  label,
  onClick,
  active,
  disabled,
  className,
}: DockButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={cn(
        "flex size-9 items-center justify-center rounded-xl transition-colors",
        disabled
          ? "cursor-not-allowed text-muted-foreground/40"
          : active
            ? "bg-foreground/15 text-foreground"
            : "text-muted-foreground hover:bg-foreground/10 hover:text-foreground",
        className,
      )}
    >
      <Icon className="size-4" />
    </button>
  );
}

export function BottomDock({
  panels,
  onTogglePanel,
  onNewSession,
}: {
  panels: Record<DockPanel, boolean>;
  onTogglePanel: (panel: DockPanel) => void;
  onNewSession: () => void;
}) {
  const voiceState = useVoiceStore((s) => s.state);
  const toggleVoice = useVoiceStore((s) => s.toggleVoice);
  const voiceActive = voiceState.kind === "listening" || voiceState.kind === "connecting";
  const voiceBusy = voiceState.kind === "downloading_model" || voiceState.kind === "connecting";

  return (
    <div className="pointer-events-auto fixed bottom-4 left-1/2 z-30 -translate-x-1/2">
      <div className="flex items-center gap-1 rounded-2xl border border-border bg-card/70 px-2 py-1.5 shadow-xl backdrop-blur-md">
        <DockButton icon={PlusIcon} label="New conversation" onClick={onNewSession} />
        <DockButton
          icon={voiceActive ? PhoneIcon : MicIcon}
          label={voiceActive ? "End call" : "Start call"}
          onClick={toggleVoice}
          disabled={voiceBusy}
          active={voiceActive}
          className={voiceActive ? "rotate-0" : ""}
        />

        <span className="mx-1 h-5 w-px bg-border" />

        <DockButton
          icon={ListTodoIcon}
          label="Tasks"
          onClick={() => onTogglePanel("tasks")}
          active={panels.tasks}
        />
        <DockButton
          icon={PlugIcon}
          label="Extensions"
          onClick={() => onTogglePanel("extensions")}
          active={panels.extensions}
        />
        <DockButton
          icon={SettingsIcon}
          label="Settings"
          onClick={() => onTogglePanel("settings")}
          active={panels.settings}
        />
      </div>
    </div>
  );
}
