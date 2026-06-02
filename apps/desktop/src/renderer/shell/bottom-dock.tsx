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

// The bottom dock is the always-available way to talk to the agent: the chat
// composer (typed input) on the left, a voice mic toggle on the right. The
// conversation history and other panels are launched from the LeftDock.

export function BottomDock() {
  const voiceState = useVoiceStore((s) => s.state);
  const toggleVoice = useVoiceStore((s) => s.toggleVoice);
  const voiceActive = voiceState.kind === "listening" || voiceState.kind === "connecting";
  const voiceBusy = voiceState.kind === "downloading_model" || voiceState.kind === "connecting";

  const MicGlyph = voiceActive ? PhoneIcon : MicIcon;
  const voiceLabel = voiceActive ? "End call" : "Start call";

  return (
    <div className="pointer-events-auto fixed bottom-4 left-1/2 z-30 w-full max-w-xl -translate-x-1/2 px-4">
      <TooltipProvider>
        <div className="flex items-end gap-1.5 rounded-2xl border border-border bg-card/70 p-1.5 shadow-xl backdrop-blur-md">
          <div className="min-w-0 flex-1">
            <Composer className="bg-transparent px-1 py-0 backdrop-blur-none" />
          </div>

          <Tooltip>
            <TooltipTrigger
              onClick={toggleVoice}
              disabled={voiceBusy}
              aria-label={voiceLabel}
              className={cn(
                "mb-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl transition-colors",
                voiceBusy
                  ? "cursor-not-allowed text-muted-foreground/40"
                  : voiceActive
                    ? "bg-foreground/15 text-foreground"
                    : "text-muted-foreground hover:bg-foreground/10 hover:text-foreground",
              )}
            >
              <MicGlyph className="size-4" />
            </TooltipTrigger>
            <TooltipContent side="top">{voiceLabel}</TooltipContent>
          </Tooltip>
        </div>
      </TooltipProvider>
    </div>
  );
}
