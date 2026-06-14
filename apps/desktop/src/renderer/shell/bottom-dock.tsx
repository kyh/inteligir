import { MicIcon, PhoneIcon } from "lucide-react";

import { cn } from "@repo/ui/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@repo/ui/components/tooltip";
import { Composer } from "@/renderer/shell/chat/composer";
import { useVoiceStore } from "@/renderer/stores/voice-store";

// The bottom dock is the always-available way to talk to the agent: a single
// frosted-glass pill holding the chat composer (typed input) with a voice mic
// toggle tucked beside the send button. The conversation history and other
// panels are launched from the LeftDock.

export function BottomDock() {
  const voiceState = useVoiceStore((s) => s.state);
  const ttsConfigured = useVoiceStore((s) => s.ttsConfigured);
  const toggleVoice = useVoiceStore((s) => s.toggleVoice);
  const voiceActive = voiceState.kind === "listening" || voiceState.kind === "connecting";
  const voiceBusy = voiceState.kind === "downloading_model" || voiceState.kind === "connecting";
  // Probe finished and found no TTS key: toggleVoice would silently no-op
  // (no pipeline exists), so render the mic visibly unavailable and point at
  // Settings instead. aria-disabled (not `disabled`) keeps hover events so
  // the explanatory tooltip still shows.
  const voiceUnavailable = ttsConfigured === false;

  const MicGlyph = voiceActive ? PhoneIcon : MicIcon;
  const voiceLabel = voiceUnavailable
    ? "Voice is unavailable — add an ElevenLabs API key in Settings"
    : voiceActive
      ? "End call"
      : "Start call";

  return (
    <div className="bottom-dock-shell pointer-events-none fixed bottom-6 left-1/2 z-30 w-full max-w-2xl -translate-x-1/2 px-4">
      <TooltipProvider>
        <Composer
          className="pointer-events-auto"
          trailing={
            <Tooltip>
              <TooltipTrigger
                onClick={voiceUnavailable ? undefined : toggleVoice}
                disabled={voiceBusy}
                aria-disabled={voiceUnavailable || voiceBusy}
                aria-label={voiceLabel}
                // Lives on the smoked-glass composer — white-on-glass control
                // language in both themes (the glass is always dark).
                className={cn(
                  "flex size-7 shrink-0 items-center justify-center rounded-full transition-[color,background-color,transform]",
                  voiceUnavailable || voiceBusy
                    ? "cursor-not-allowed text-white/30"
                    : voiceActive
                      ? "bg-glass-row-active text-glass-fg"
                      : "text-glass-fg-muted hover:-translate-y-0.5 hover:bg-glass-row hover:text-glass-fg",
                )}
              >
                <MicGlyph className="size-3.5" />
              </TooltipTrigger>
              <TooltipContent side="top">{voiceLabel}</TooltipContent>
            </Tooltip>
          }
        />
      </TooltipProvider>
    </div>
  );
}
