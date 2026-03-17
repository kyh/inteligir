import { useVoiceStore } from "@/renderer/stores/voice-store";

export function VoiceIndicator() {
  const sessionState = useVoiceStore((s) => s.sessionState);
  const currentTranscript = useVoiceStore((s) => s.currentTranscript);
  const error = useVoiceStore((s) => s.error);

  if (sessionState === "inactive") return null;

  let label: string | null = null;
  if (error) {
    label = error;
  } else if (sessionState === "listening" && currentTranscript) {
    label = `"${currentTranscript}..."`;
  } else if (sessionState === "listening") {
    label = "Listening...";
  } else if (sessionState === "processing") {
    label = "Thinking...";
  } else if (sessionState === "speaking") {
    label = "Speaking...";
  } else if (sessionState === "starting") {
    label = "Connecting...";
  }

  if (!label) return null;

  return (
    <div className="pointer-events-auto w-full max-w-sm px-2 py-1 text-[10px] text-muted-foreground">
      {label}
    </div>
  );
}
