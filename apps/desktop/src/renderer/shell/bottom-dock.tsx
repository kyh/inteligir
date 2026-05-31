import { useMemo } from "react";
import { MicIcon, PhoneIcon } from "lucide-react";

import { cn } from "@repo/ui/lib/utils";
import { toast } from "@repo/ui/components/sonner";
import { BUILTIN_WIDGET_UI } from "@/renderer/shell/builtin-widgets";
import { getBridge } from "@/renderer/lib/bridge";
import { useShellStore } from "@/renderer/stores/shell-store";
import { useVoiceStore } from "@/renderer/stores/voice-store";
import { BUILTIN_DEFS, CHAT_WIDGET_ID } from "@/shared/shell";

// The dock is the launcher for built-in widgets only. Custom (JSON-UI) widgets
// live in the Widgets panel — keeping the dock fixed-size avoids growing every
// time the agent installs something.
const CHAT_DEF = BUILTIN_DEFS.find((d) => d.id === CHAT_WIDGET_ID);
const SECONDARY_BUILTINS = BUILTIN_DEFS.filter((d) => d.id !== CHAT_WIDGET_ID);

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

function launchWidget(widgetId: string): void {
  // placeWidget rejects when the renderer flush of an existing singleton's
  // pending state didn't persist — surface that to the user instead of
  // letting it land as an unhandled promise rejection.
  getBridge()
    ?.placeWidget(widgetId)
    .catch((err) => {
      toast.error(err instanceof Error ? err.message : "Couldn't open the widget");
    });
}

export function BottomDock() {
  const voiceState = useVoiceStore((s) => s.state);
  const toggleVoice = useVoiceStore((s) => s.toggleVoice);
  const voiceActive = voiceState.kind === "listening" || voiceState.kind === "connecting";
  const voiceBusy = voiceState.kind === "downloading_model" || voiceState.kind === "connecting";

  const instances = useShellStore((s) => s.instances);
  const placedWidgetIds = useMemo(() => {
    const ids = new Set<string>();
    for (const i of instances) {
      ids.add(i.widgetId);
    }
    return ids;
  }, [instances]);

  return (
    <div className="pointer-events-auto fixed bottom-4 left-1/2 z-30 -translate-x-1/2">
      <div className="flex items-center gap-1 rounded-2xl border border-border bg-card/70 px-2 py-1.5 shadow-xl backdrop-blur-md">
        {CHAT_DEF && (
          <DockButton
            icon={BUILTIN_WIDGET_UI[CHAT_DEF.id].icon}
            label={CHAT_DEF.title}
            active={placedWidgetIds.has(CHAT_DEF.id)}
            onClick={() => launchWidget(CHAT_DEF.id)}
          />
        )}
        <DockButton
          icon={voiceActive ? PhoneIcon : MicIcon}
          label={voiceActive ? "End call" : "Start call"}
          onClick={toggleVoice}
          disabled={voiceBusy}
          active={voiceActive}
        />

        <span className="mx-1 h-5 w-px bg-border" />

        {SECONDARY_BUILTINS.map((def) => (
          <DockButton
            key={def.id}
            icon={BUILTIN_WIDGET_UI[def.id].icon}
            label={def.title}
            active={placedWidgetIds.has(def.id)}
            onClick={() => launchWidget(def.id)}
          />
        ))}
      </div>
    </div>
  );
}
