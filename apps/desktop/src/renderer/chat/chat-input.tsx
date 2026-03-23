import { useCallback, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";

import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@repo/ui/input-group";
import { MicIcon, MicOffIcon, SendIcon, SquareIcon } from "lucide-react";

import { useAgentStore } from "@/renderer/stores/agent-store";
import { useVoiceStore } from "@/renderer/stores/voice-store";

export function ChatInput() {
  const [input, setInput] = useState("");

  const busy = useAgentStore(
    (s) => s.appState.phase === "ready" && s.appState.agent === "busy",
  );
  // Route text commands through LiveKit data channels via voice store
  const sendMessage = useVoiceStore((s) => s.sendMessage);
  const steer = useVoiceStore((s) => s.steer);
  const interrupt = useVoiceStore((s) => s.interrupt);
  const clearChat = useVoiceStore((s) => s.clearChat);

  const sessionState = useVoiceStore((s) => s.sessionState);
  const toggleVoice = useVoiceStore((s) => s.toggleVoice);

  const voiceActive = sessionState !== "inactive" && sessionState !== "error";
  const VoiceIcon = voiceActive ? MicIcon : MicOffIcon;
  const voiceTitle = voiceActive ? "Stop voice" : "Start voice";

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
        useAgentStore.getState().clearMessages();
        clearChat();
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
    [busy, input, interrupt, clearChat],
  );

  return (
    <div className="w-full max-w-md">
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
              className={sessionState === "connecting" ? "animate-pulse" : ""}
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
