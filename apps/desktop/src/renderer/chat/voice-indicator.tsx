import type { VoiceSessionState } from "@/shared/voice";
import { useVoiceStore } from "@/renderer/stores/voice-store";

const stateLabels: Record<VoiceSessionState, string | null> = {
  inactive: null,
  connecting: "Connecting...",
  connected: "Listening...",
  error: null, // error text comes from store.error
};

export function VoiceIndicator() {
  const sessionState = useVoiceStore((s) => s.sessionState);
  const currentTranscript = useVoiceStore((s) => s.currentTranscript);
  const error = useVoiceStore((s) => s.error);

  if (sessionState === "inactive") return null;

  const label =
    error ? error
    : sessionState === "connected" && currentTranscript ? `"${currentTranscript}..."`
    : stateLabels[sessionState];

  if (!label) return null;

  return (
    <div className="pointer-events-auto w-full max-w-sm px-2 py-1 text-[10px] text-muted-foreground">
      {label}
    </div>
  );
}
