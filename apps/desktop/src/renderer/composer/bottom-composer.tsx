import { useEffect, useState } from "react";
import { PinIcon, PinOffIcon, XIcon } from "lucide-react";

import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@repo/ui/components/ai-elements/conversation";
import { cn } from "@repo/ui/lib/utils";

import { ChatActivityRow, ChatMessageView } from "@/renderer/composer/chat-message";
import { Composer } from "@/renderer/composer/composer";
import { useAgentStore } from "@/renderer/stores/agent-store";
import { useViewStore } from "@/renderer/stores/view-store";

const IDLE_LINGER_MS = 7000;

/**
 * The bottom AI surface — the composer pinned to the bottom of the editor inset,
 * with a transient response popover that grows upward from it. The popover opens
 * while the agent is working (and lingers briefly after), or stays open when
 * pinned. Replaces the old right-hand chat column.
 */
export function BottomComposer() {
  const messages = useAgentStore((s) => s.messages);
  const appState = useAgentStore((s) => s.appState);
  const busy = appState.phase === "ready" && appState.agent === "busy";

  const pinned = useViewStore((s) => s.responsePinned);
  const togglePinned = useViewStore((s) => s.togglePinned);
  const setPinned = useViewStore((s) => s.setPinned);

  // Linger open for a few seconds after the agent goes idle so the answer is
  // readable, then auto-collapse (unless pinned).
  const [recentlyActive, setRecentlyActive] = useState(false);
  useEffect(() => {
    if (busy) {
      setRecentlyActive(true);
      return;
    }
    const t = setTimeout(() => setRecentlyActive(false), IDLE_LINGER_MS);
    return () => clearTimeout(t);
  }, [busy]);

  const open = (pinned || busy || recentlyActive) && messages.length > 0;

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 flex flex-col items-center gap-2 px-4 pb-4">
      {open && (
        <div className="pointer-events-auto flex w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-md">
          <div className="flex items-center justify-between border-b border-border px-3 py-1.5 text-[11px] font-medium text-muted-foreground">
            <span>Assistant</span>
            <div className="flex items-center gap-0.5">
              <button
                type="button"
                onClick={togglePinned}
                title={pinned ? "Unpin" : "Keep open"}
                className={cn(
                  "rounded p-1 hover:bg-muted hover:text-foreground",
                  pinned && "text-foreground",
                )}
              >
                {pinned ? <PinOffIcon className="size-3.5" /> : <PinIcon className="size-3.5" />}
              </button>
              <button
                type="button"
                onClick={() => {
                  setPinned(false);
                  setRecentlyActive(false);
                }}
                title="Close"
                className="rounded p-1 hover:bg-muted hover:text-foreground"
              >
                <XIcon className="size-3.5" />
              </button>
            </div>
          </div>
          <Conversation className="max-h-[46vh] min-h-0 select-text">
            <ConversationContent className="gap-1 p-2">
              {messages.map((msg) => (
                <ChatMessageView key={msg.id} message={msg} />
              ))}
              <ChatActivityRow messages={messages} busy={busy} />
            </ConversationContent>
            <ConversationScrollButton />
          </Conversation>
        </div>
      )}

      <div className="pointer-events-auto w-full max-w-3xl">
        <Composer />
      </div>
    </div>
  );
}
