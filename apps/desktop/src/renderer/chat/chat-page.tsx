import { useCallback, useEffect, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";

import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@repo/ui/conversation";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@repo/ui/input-group";
import { MessageSquareIcon, MicIcon, SendIcon, SquareIcon } from "lucide-react";

import { ChatMessageView } from "@/renderer/chat/chat-message";
import { VoiceButton } from "@/renderer/chat/voice-button";
import { VoiceIndicator } from "@/renderer/chat/voice-indicator";
import { useAgentStore } from "@/renderer/stores/agent-store";
import { useVoiceStore } from "@/renderer/stores/voice-store";

type Mode = "voice" | "text";

export function ChatPage() {
  const messages = useAgentStore((s) => s.messages);
  const busy = useAgentStore(
    (s) => s.appState.phase === "ready" && s.appState.agent === "busy",
  );
  const sendMessage = useAgentStore((s) => s.sendMessage);
  const steer = useAgentStore((s) => s.steer);
  const interrupt = useAgentStore((s) => s.interrupt);

  const initVoice = useVoiceStore((s) => s.init);
  useEffect(() => initVoice(), [initVoice]);

  const [input, setInput] = useState("");
  const [mode, setMode] = useState<Mode>("voice");

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
      if (e.key === "Escape") {
        e.preventDefault();
        if (busy) {
          interrupt();
        } else if (input.length > 0) {
          setInput("");
        }
      }
    },
    [busy, input, interrupt],
  );

  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col justify-end p-4">
      {/* Messages (text mode only) */}
      {mode === "text" && messages.length > 0 && (
        <Conversation className="pointer-events-auto mb-2 max-h-[50%] w-full max-w-sm">
          <ConversationContent className="space-y-1 pb-2">
            {messages.map((msg) => (
              <ChatMessageView key={msg.id} message={msg} />
            ))}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>
      )}

      {/* Voice status (voice mode only) */}
      {mode === "voice" && <VoiceIndicator />}

      {/* Controls */}
      <div className="pointer-events-auto max-w-sm">
        {mode === "text" ? (
          <form onSubmit={send}>
            <InputGroup className="text-foreground text-sm">
              <InputGroupAddon>
                <InputGroupButton
                  type="button"
                  size="icon-xs"
                  onClick={() => setMode("voice")}
                  title="Switch to voice"
                >
                  <MicIcon />
                </InputGroupButton>
              </InputGroupAddon>
              <InputGroupInput
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={busy ? "Redirect..." : "Message..."}
              />
              <InputGroupAddon align="inline-end" className="mt-auto">
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
        ) : (
          <div className="flex gap-2">
            <button
              type="button"
              className="bg-input/40 text-muted-foreground hover:text-foreground rounded-md p-2 backdrop-blur-sm transition"
              onClick={() => setMode("text")}
              title="Switch to text"
            >
              <MessageSquareIcon className="size-4" />
            </button>
            <VoiceButton />
          </div>
        )}
      </div>
    </div>
  );
}
