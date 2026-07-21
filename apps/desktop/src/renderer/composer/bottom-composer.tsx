import { memo, useEffect, useState } from "react";
import { PinIcon, PinOffIcon, XIcon } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@repo/ui/components/message-scroller";
import { cn } from "@repo/ui/lib/utils";

import {
  CAPSULE_RADIUS,
  CAPSULE_SURFACE,
  ThinkingSweep,
  useCapsuleSpring,
} from "@renderer/composer/capsule-motion";
import {
  ChatActivityRow,
  ChatMessageView,
  isRenderableMessage,
} from "@renderer/composer/chat-message";
import { Composer } from "@renderer/composer/composer";
import { useAgentStore } from "@renderer/stores/agent-store";
import { currentTurnMessages, type ChatMessage } from "@renderer/stores/chat-log-view";
import { useViewStore } from "@renderer/stores/view-store";

const IDLE_LINGER_MS = 7000;

/** Thinking = busy with no assistant text streamed for the CURRENT turn yet
 * (tool-only activity still counts as thinking). */
function isThinking(messages: ChatMessage[], busy: boolean): boolean {
  if (!busy) return false;
  return !currentTurnMessages(messages).some((msg) => {
    if (msg.role !== "assistant") return false;
    const first = msg.parts[0];
    return first?.type === "text" && first.text.length > 0;
  });
}

/** One popover row: entrance animation + the bubble. Memoized on the message
 * object — the store preserves identity of untouched messages, so while a
 * reply streams (a new `messages` array per delta) only the streaming row
 * re-renders instead of every historical bubble + motion wrapper. */
const MessageRow = memo(function MessageRow({ msg }: { msg: ChatMessage }) {
  const reduceMotion = useReducedMotion() === true;
  return (
    <motion.div
      className="flex flex-col"
      initial={{ opacity: 0, y: 6, filter: "blur(4px)" }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      transition={reduceMotion ? { duration: 0 } : { duration: 0.3, delay: 0.05 }}
    >
      <ChatMessageView message={msg} />
    </motion.div>
  );
});

/**
 * The bottom AI surface — the composer pinned to the bottom of the editor inset,
 * with a transient response popover that grows upward from it. The popover opens
 * while the agent is working (and lingers briefly after), or stays open when
 * pinned. It shares the composer capsule's radius/surface/ring and springs
 * open/closed so the pair reads as one object expanding upward.
 */
export function BottomComposer() {
  const messages = useAgentStore((s) => s.messages);
  const appState = useAgentStore((s) => s.appState);
  const busy = appState.phase === "ready" && appState.agent === "busy";
  const thinking = isThinking(messages, busy);
  const { capsule: popoverSpring } = useCapsuleSpring();

  const pinned = useViewStore((s) => s.responsePinned);
  const togglePinned = useViewStore((s) => s.togglePinned);
  const setPinned = useViewStore((s) => s.setPinned);

  // Linger open for a few seconds after the agent goes idle so the answer is
  // readable, then auto-collapse (unless pinned).
  const [recentlyActive, setRecentlyActive] = useState(false);
  // The X while busy: `busy` alone would reopen the panel on the next render,
  // so Close latches a dismissal that only the NEXT turn start clears.
  // Dismissing a long stream mid-flight is legitimate — the X stays visible.
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    if (busy) {
      setRecentlyActive(true);
      setDismissed(false);
      return;
    }
    const t = setTimeout(() => setRecentlyActive(false), IDLE_LINGER_MS);
    return () => clearTimeout(t);
  }, [busy]);

  const open = (pinned || busy || recentlyActive) && !dismissed && messages.length > 0;
  const visibleMessages = messages.filter(isRenderableMessage);

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 flex flex-col items-center gap-2 px-4 pb-4">
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="response"
            style={{ borderRadius: CAPSULE_RADIUS }}
            initial={{ opacity: 0, y: 12, scale: 0.97, filter: "blur(6px)" }}
            animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
            exit={{ opacity: 0, y: 12, scale: 0.97, filter: "blur(6px)" }}
            transition={popoverSpring}
            className={cn("pointer-events-auto flex w-full max-w-3xl flex-col", CAPSULE_SURFACE)}
          >
            <AnimatePresence>{thinking && <ThinkingSweep key="sweep" />}</AnimatePresence>
            <div className="relative flex items-center justify-between border-b border-border px-3 py-1.5 text-[11px] font-medium text-muted-foreground">
              <span>Assistant</span>
              <div className="flex items-center gap-0.5">
                <button
                  type="button"
                  aria-label={pinned ? "Unpin response" : "Keep response open"}
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
                  aria-label="Close response"
                  onClick={() => {
                    setPinned(false);
                    setRecentlyActive(false);
                    setDismissed(true);
                  }}
                  title="Close"
                  className="rounded p-1 hover:bg-muted hover:text-foreground"
                >
                  <XIcon className="size-3.5" />
                </button>
              </div>
            </div>
            <MessageScrollerProvider>
              <MessageScroller className="max-h-[46vh] min-h-0 select-text" role="log">
                <MessageScrollerViewport>
                  <MessageScrollerContent className="gap-1 p-2">
                    {visibleMessages.map((msg) => (
                      <MessageRow key={msg.id} msg={msg} />
                    ))}
                    <ChatActivityRow messages={messages} busy={busy} />
                  </MessageScrollerContent>
                </MessageScrollerViewport>
                <MessageScrollerButton />
              </MessageScroller>
            </MessageScrollerProvider>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="pointer-events-auto w-full max-w-3xl">
        <Composer />
      </div>
    </div>
  );
}
