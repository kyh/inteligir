import { useMemo } from "react";
import { MicIcon, PhoneIcon, PlusIcon } from "lucide-react";

import { cn } from "@repo/ui/lib/utils";
import { widgetIcon } from "@/renderer/shell/widget-render";
import { getBridge } from "@/renderer/lib/bridge";
import { useShellStore } from "@/renderer/stores/shell-store";
import { useVoiceStore } from "@/renderer/stores/voice-store";

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

  // The dock is the gallery for every installed widget — built-ins and
  // customs alike. Permanent ones (chat) don't appear here; you can't toggle
  // them off. Clicking toggles placement on the workspace.
  const defs = useShellStore((s) => s.defs);
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

  const visibleDefs = defs.filter((d) => !d.permanent);

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

        {visibleDefs.length > 0 ? <span className="mx-1 h-5 w-px bg-border" /> : null}

        {visibleDefs.map((def) => (
          <DockButton
            key={def.id}
            icon={widgetIcon(def)}
            label={def.title}
            active={placedInstanceId.has(def.id)}
            onClick={() => toggle(def.id)}
          />
        ))}
      </div>
    </div>
  );
}
