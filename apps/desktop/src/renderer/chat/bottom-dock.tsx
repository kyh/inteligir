import { useMemo } from "react";
import { MicIcon, PhoneIcon, PlusIcon } from "lucide-react";

import { cn } from "@repo/ui/lib/utils";
import { BUILTIN_WIDGET_UI } from "@/renderer/chat/builtin-widgets";
import { getBridge } from "@/renderer/lib/bridge";
import { useShellStore } from "@/renderer/stores/shell-store";
import { useVoiceStore } from "@/renderer/stores/voice-store";
import { BUILTIN_WIDGETS } from "@/shared/shell";

type DockButtonProps = {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
};

function DockButton({ icon: Icon, label, onClick, active, disabled }: DockButtonProps) {
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
      )}
    >
      <Icon className="size-4" />
    </button>
  );
}

export function BottomDock({ onNewSession }: { onNewSession: () => void }) {
  const voiceState = useVoiceStore((s) => s.state);
  const toggleVoice = useVoiceStore((s) => s.toggleVoice);
  const voiceActive = voiceState.kind === "listening" || voiceState.kind === "connecting";
  const voiceBusy = voiceState.kind === "downloading_model" || voiceState.kind === "connecting";

  // The dock is the gallery for the built-in widgets. Toggle each one's
  // placement on the shell (singletons, so one instance per widget).
  const instances = useShellStore((s) => s.instances);
  const placedInstanceId = useMemo(() => {
    const map = new Map<string, string>();
    for (const i of instances) map.set(i.widgetId, i.instanceId);
    return map;
  }, [instances]);

  const toggle = (widgetId: string) => {
    const instanceId = placedInstanceId.get(widgetId);
    if (instanceId) void getBridge()?.unplaceWidget(instanceId);
    else void getBridge()?.placeWidget(widgetId);
  };

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
        />

        <span className="mx-1 h-5 w-px bg-border" />

        {BUILTIN_WIDGETS.filter((b) => !b.permanent).map((b) => (
          <DockButton
            key={b.id}
            icon={BUILTIN_WIDGET_UI[b.id].icon}
            label={b.title}
            active={placedInstanceId.has(b.id)}
            onClick={() => toggle(b.id)}
          />
        ))}
      </div>
    </div>
  );
}
