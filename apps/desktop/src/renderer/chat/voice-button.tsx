import { useCallback } from "react";

import { InputGroupButton } from "@repo/ui/input-group";
import { MicIcon, MicOffIcon, Volume2Icon } from "lucide-react";

import { useVoiceStore } from "@/renderer/stores/voice-store";

export function VoiceButton() {
  const sessionState = useVoiceStore((s) => s.sessionState);
  const isConfigured = useVoiceStore((s) => s.isConfigured);
  const toggleVoice = useVoiceStore((s) => s.toggleVoice);
  const interruptTts = useVoiceStore((s) => s.interruptTts);

  const handleClick = useCallback(() => {
    if (sessionState === "speaking") {
      interruptTts();
    } else {
      toggleVoice();
    }
  }, [sessionState, toggleVoice, interruptTts]);

  if (!isConfigured) return null;

  const isActive = sessionState !== "inactive";
  const isSpeaking = sessionState === "speaking";

  const Icon = isSpeaking ? Volume2Icon : isActive ? MicIcon : MicOffIcon;
  const title = isSpeaking
    ? "Interrupt"
    : isActive
      ? "Stop voice"
      : "Start voice";

  return (
    <InputGroupButton
      type="button"
      size="icon-xs"
      onClick={handleClick}
      className={isSpeaking ? "animate-pulse" : ""}
      title={title}
    >
      <Icon />
    </InputGroupButton>
  );
}
