import { useEffect, useState } from "react";
import { PinIcon, PinOffIcon, XIcon } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion, type Transition } from "framer-motion";

import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@renderer/ai-elements/conversation";
import { cn } from "@repo/ui/lib/utils";

import {
  CAPSULE_RADIUS,
  CAPSULE_SPRING,
  CAPSULE_SURFACE,
  ThinkingSweep,
} from "@renderer/composer/capsule-motion";
import { ChatActivityRow, ChatMessageView } from "@renderer/composer/chat-message";
import { Composer } from "@renderer/composer/composer";
import { useAgentStore, type ChatMessage } from "@renderer/stores/agent-store";
import { useViewStore } from "@renderer/stores/view-store";

const IDLE_LINGER_MS = 7000;

/** The messages ChatMessageView actually renders as a bubble. Tool activity
 * and empty stream-starts render null — skip their motion wrappers too, so
 * the list's flex gap doesn't produce phantom rows. */
function isRenderableMessage(msg: ChatMessage): boolean {
  const first = msg.parts[0];
  if (!first || first.type !== "text") return false;
  if (msg.role === "assistant" && first.text.length === 0) return false;
  return true;
}

/** Thinking = busy with no assistant text streamed for the CURRENT turn yet
 * (tool-only activity still counts as thinking). Walk back to the turn's
 * user prompt; steer nudges ride mid-turn and don't reset the boundary. */
function isThinking(messages: ChatMessage[], busy: boolean): boolean {
  if (!busy) return false;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (!msg) continue;
    if (msg.role === "user" && !msg.metadata?.steer) return true;
    if (msg.role !== "assistant") continue;
    const first = msg.parts[0];
    if (first?.type === "text" && first.text.length > 0) return false;
  }
  return true;
}

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
  const reduceMotion = useReducedMotion() === true;

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
  const visibleMessages = messages.filter(isRenderableMessage);
  const popoverSpring: Transition = reduceMotion ? { duration: 0 } : CAPSULE_SPRING;

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
                {visibleMessages.map((msg) => (
                  // Blur-in entrance for each landing message; the bubble's own
                  // spring (ai-elements/chat-message) supplies the rise.
                  <motion.div
                    key={msg.id}
                    className="flex flex-col"
                    initial={{ opacity: 0, y: 6, filter: "blur(4px)" }}
                    animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                    transition={reduceMotion ? { duration: 0 } : { duration: 0.3, delay: 0.05 }}
                  >
                    <ChatMessageView message={msg} />
                  </motion.div>
                ))}
                <ChatActivityRow messages={messages} busy={busy} />
              </ConversationContent>
              <ConversationScrollButton />
            </Conversation>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="pointer-events-auto w-full max-w-3xl">
        <Composer />
      </div>
    </div>
  );
}
