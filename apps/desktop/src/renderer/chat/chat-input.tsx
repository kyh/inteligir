import { useCallback, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";

import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@repo/ui/input-group";
import { MicIcon, MicOffIcon, SendIcon, SquareIcon, Volume2Icon } from "lucide-react";

import { useAgentStore } from "@/renderer/stores/agent-store";
import { useVoiceStore } from "@/renderer/stores/voice-store";

export function ChatInput() {
  const [input, setInput] = useState("");

  const busy = useAgentStore(
    (s) => s.appState.phase === "ready" && s.appState.agent === "busy",
  );
  const sendMessage = useAgentStore((s) => s.sendMessage);
  const steer = useAgentStore((s) => s.steer);
  const interrupt = useAgentStore((s) => s.interrupt);
  const clearMessages = useAgentStore((s) => s.clearMessages);

  const sessionState = useVoiceStore((s) => s.sessionState);
  const toggleVoice = useVoiceStore((s) => s.toggleVoice);

  const voiceActive = sessionState !== "inactive";
  const voiceSpeaking = sessionState === "speaking";

  const VoiceIcon = voiceSpeaking
    ? Volume2Icon
    : voiceActive
      ? MicIcon
      : MicOffIcon;

  const voiceTitle = voiceSpeaking
    ? "Interrupt"
    : voiceActive
      ? "Stop voice"
      : "Start voice";

  const send = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      const text = input.trim();
      if (!text) return;
      setInput("");
      if (busy) {
        steer(text);
      } else {
        sendMessage(text);
      }
    },
    [input, busy, sendMessage, steer],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        clearMessages();
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        if (busy) {
          interrupt();
        } else if (input.length > 0) {
          setInput("");
        }
      }
    },
    [busy, input, interrupt, clearMessages],
  );

  return (
    <div className="pointer-events-auto w-full max-w-md">
      <form onSubmit={send}>
        <InputGroup className="bg-background/80 text-foreground text-sm shadow-lg backdrop-blur-md">
          <InputGroupInput
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={busy ? "Redirect..." : "Message..."}
          />
          <InputGroupAddon align="inline-end" className="mt-auto gap-1">
            <InputGroupButton
              type="button"
              size="icon-xs"
              onClick={toggleVoice}
              title={voiceTitle}
              className={voiceSpeaking ? "animate-pulse" : ""}
            >
              <VoiceIcon />
            </InputGroupButton>
            {busy && !input.trim() ? (
              <InputGroupButton
                type="button"
                size="icon-xs"
                onClick={interrupt}
              >
                <SquareIcon />
              </InputGroupButton>
            ) : (
              <InputGroupButton type="submit" size="icon-xs">
                <SendIcon />
              </InputGroupButton>
            )}
          </InputGroupAddon>
        </InputGroup>
      </form>
    </div>
  );
}
