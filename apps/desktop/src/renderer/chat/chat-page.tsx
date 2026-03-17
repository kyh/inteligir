import { useCallback, useState } from "react";
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
import { MessageSquareIcon, SendIcon, SquareIcon } from "lucide-react";

import { ChatMessageView } from "@/renderer/chat/chat-message";
import { useAgentStore } from "@/renderer/stores/agent-store";

export function ChatPage() {
  const messages = useAgentStore((s) => s.messages);
  const busy = useAgentStore(
    (s) => s.appState.phase === "ready" && s.appState.agent === "busy",
  );
  const sendMessage = useAgentStore((s) => s.sendMessage);
  const steer = useAgentStore((s) => s.steer);
  const interrupt = useAgentStore((s) => s.interrupt);

  const [input, setInput] = useState("");
  const [showText, setShowText] = useState(false);

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
      {/* Messages */}
      {showText && messages.length > 0 && (
        <Conversation className="pointer-events-auto mb-2 max-h-[50%] w-full max-w-sm">
          <ConversationContent className="space-y-1 pb-2">
            {messages.map((msg) => (
              <ChatMessageView key={msg.id} message={msg} />
            ))}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>
      )}

      {/* Input */}
      <div className="pointer-events-auto w-full max-w-sm">
        <form onSubmit={send}>
          <InputGroup className="text-foreground border-none text-sm">
            <InputGroupAddon>
              <InputGroupButton
                type="button"
                size="icon-xs"
                onClick={() => setShowText(!showText)}
              >
                <MessageSquareIcon />
              </InputGroupButton>
            </InputGroupAddon>
            {showText && (
              <>
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
              </>
            )}
          </InputGroup>
        </form>
      </div>
    </div>
  );
}
