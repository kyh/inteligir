import { useCallback } from "react";

import { MicIcon, MicOffIcon } from "lucide-react";

import { useVoiceStore } from "@/renderer/stores/voice-store";

export function VoiceButton({ className }: { className?: string }) {
  const stateKind = useVoiceStore((s) => s.state.kind);
  const toggleVoice = useVoiceStore((s) => s.toggleVoice);

  const handleClick = useCallback(() => {
    toggleVoice();
  }, [toggleVoice]);

  const isActive = stateKind === "listening";
  const Icon = isActive ? MicIcon : MicOffIcon;
  const title = isActive ? "Stop voice" : "Start voice";

  return (
    <button
      type="button"
      onClick={handleClick}
      className={`bg-input/40 text-muted-foreground hover:text-foreground rounded-md p-2 backdrop-blur-sm transition ${isActive ? "animate-pulse" : ""} ${className ?? ""}`}
      title={title}
    >
      <Icon className="size-4" />
    </button>
  );
}
