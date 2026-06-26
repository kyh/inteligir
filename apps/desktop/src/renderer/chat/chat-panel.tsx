import { MessageSquareIcon } from "lucide-react";

import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@repo/ui/components/ai-elements/conversation";

import { ChatActivityRow, ChatMessageView } from "@/renderer/chat/chat-message";
import { Composer } from "@/renderer/chat/composer";
import { useAgentStore } from "@/renderer/stores/agent-store";
import { useVoiceStore } from "@/renderer/stores/voice-store";

/**
 * The chat surface — the app's secondary panel beside the editor. One ongoing
 * thread (the persistent assistant), a live transcript, and the composer.
 */
export function ChatPanel() {
  const messages = useAgentStore((s) => s.messages);
  const appState = useAgentStore((s) => s.appState);
  const busy = appState.phase === "ready" && appState.agent === "busy";

  const voiceState = useVoiceStore((s) => s.state);
  const currentTranscript = voiceState.kind === "listening" ? voiceState.currentTranscript : "";

  return (
    <div className="flex h-full flex-col">
      <Conversation className="min-h-0 flex-1 select-text px-3 pt-3">
        <ConversationContent className="gap-1 p-0 pb-2">
          {messages.length === 0 && !busy ? (
            <ConversationEmptyState
              title="No messages yet"
              description="Ask the agent to edit your notes, or speak to begin."
              icon={<MessageSquareIcon className="size-6" />}
            />
          ) : (
            <>
              {messages.map((msg) => (
                <ChatMessageView key={msg.id} message={msg} />
              ))}
              <ChatActivityRow messages={messages} busy={busy} />
            </>
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      {currentTranscript && (
        <div className="px-3 pb-1">
          <p className="truncate text-xs italic text-muted-foreground">
            &ldquo;{currentTranscript}&hellip;&rdquo;
          </p>
        </div>
      )}

      <div className="flex justify-center px-3 pb-3 pt-1">
        <Composer />
      </div>
    </div>
  );
}
