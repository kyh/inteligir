import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@repo/ui/conversation";

import { ChatMessageView } from "@/renderer/chat/chat-message";
import { StatusBar } from "@/renderer/chat/status-bar";
import { useAgentStore } from "@/renderer/stores/agent-store";

export function MessageThread() {
  const messages = useAgentStore((s) => s.messages);

  return (
    <>
      <Conversation className="flex-1 px-3">
        <ConversationContent className="space-y-1 pb-2">
          {messages.length === 0 ? (
            <div className="px-1 py-4 text-center text-xs text-muted-foreground/60">
              No messages yet
            </div>
          ) : (
            messages.map((msg) => (
              <ChatMessageView key={msg.id} message={msg} />
            ))
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <StatusBar />
    </>
  );
}
