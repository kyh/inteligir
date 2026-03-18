import { useCallback } from "react";
import { useNavigate } from "react-router";

import { MicIcon, MicOffIcon, Volume2Icon } from "lucide-react";

import { useVoiceStore } from "@/renderer/stores/voice-store";

export function VoiceButton({ className }: { className?: string }) {
  const sessionState = useVoiceStore((s) => s.sessionState);
  const isConfigured = useVoiceStore((s) => s.isConfigured);
  const toggleVoice = useVoiceStore((s) => s.toggleVoice);
  const navigate = useNavigate();

  const handleClick = useCallback(() => {
    if (!isConfigured) {
      void navigate("/settings");
      return;
    }
    toggleVoice();
  }, [isConfigured, toggleVoice, navigate]);

  const isActive = sessionState !== "inactive";
  const isSpeaking = sessionState === "speaking";

  const Icon = isSpeaking ? Volume2Icon : isActive ? MicIcon : MicOffIcon;
  const title = !isConfigured
    ? "Set up voice"
    : isSpeaking
      ? "Interrupt"
      : isActive
        ? "Stop voice"
        : "Start voice";

  return (
    <button
      type="button"
      onClick={handleClick}
      className={`bg-input/40 text-muted-foreground hover:text-foreground rounded-md p-2 backdrop-blur-sm transition ${isSpeaking ? "animate-pulse" : ""} ${className ?? ""}`}
      title={title}
    >
      <Icon className="size-4" />
    </button>
  );
}
