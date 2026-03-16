import { useCallback } from "react";

import { Button } from "@repo/ui/button";

import { useVoiceStore } from "@/renderer/stores/voice-store";

function MicIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" x2="12" y1="19" y2="22" />
    </svg>
  );
}

function MicOffIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="2" x2="22" y1="2" y2="22" />
      <path d="M18.89 13.23A7.12 7.12 0 0 0 19 12v-2" />
      <path d="M5 10v2a7 7 0 0 0 12 5.66" />
      <path d="M15 9.34V5a3 3 0 0 0-5.68-1.33" />
      <path d="M9 9v3a3 3 0 0 0 5.12 2.12" />
      <line x1="12" x2="12" y1="19" y2="22" />
    </svg>
  );
}

function VolumeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 5 6 9H2v6h4l5 4V5Z" />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
    </svg>
  );
}

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

  const Icon = isSpeaking ? VolumeIcon : isActive ? MicIcon : MicOffIcon;
  const title = isSpeaking
    ? "Interrupt"
    : isActive
      ? "Stop voice"
      : "Start voice";

  return (
    <Button
      type="button"
      variant={isActive ? "default" : "outline"}
      size="icon"
      onClick={handleClick}
      className={`shrink-0 ${isSpeaking ? "animate-pulse" : ""}`}
      title={title}
    >
      <Icon className="h-4 w-4" />
    </Button>
  );
}
