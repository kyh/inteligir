import { memo, useCallback, useEffect, useState } from "react";
import { ChevronDownIcon, PinIcon, PinOffIcon, SparklesIcon, XIcon } from "lucide-react";
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
} from "@repo/workspace/composer/capsule-motion";
import {
  ChatActivityRow,
  ChatMessageView,
  isRenderableMessage,
} from "@repo/workspace/composer/chat-message";
import { Composer } from "@repo/workspace/composer/composer";
import { parseStoredBoolean, useDiskState } from "@repo/workspace/lib/use-disk-state";
import { useAgentStore } from "@repo/workspace/stores/agent-store";
import { currentTurnMessages, type ChatMessage } from "@repo/workspace/stores/chat-log-view";
import { useViewStore } from "@repo/workspace/stores/view-store";

const IDLE_LINGER_MS = 7000;

/** The collapsed/expanded choice outlives the session — a writer who put chat
 * away wants it away tomorrow too. */
const COLLAPSED_KEY = "workspace.composerCollapsed";

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
 *
 * The whole surface COLLAPSES to a single dot (⌘/, or the chevron the bottom
 * strip reveals on hover), and that choice persists. Chat is the product, not
 * decoration — so the collapsed dot keeps reporting a running turn, and the
 * onboarding surface names the shortcut, because a control that persists itself
 * away is one a new user would never find.
 */
export function BottomComposer() {
  const messages = useAgentStore((s) => s.messages);
  const appState = useAgentStore((s) => s.appState);
  const busy = appState.phase === "ready" && appState.agent === "busy";
  const thinking = isThinking(messages, busy);
  const { capsule: popoverSpring } = useCapsuleSpring();

  const [collapsed, setCollapsed] = useDiskState(COLLAPSED_KEY, false, parseStoredBoolean);
  const toggleCollapsed = useCallback(() => setCollapsed(!collapsed), [collapsed, setCollapsed]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "/") {
        e.preventDefault();
        toggleCollapsed();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleCollapsed]);

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

  if (collapsed) {
    return <CollapsedDot busy={busy} onExpand={toggleCollapsed} />;
  }

  return (
    <div className="group pointer-events-none absolute inset-x-0 bottom-7 z-30 flex flex-col items-center gap-2 px-4 pb-4">
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

      <div className="pointer-events-auto flex w-full max-w-3xl items-end gap-1">
        <div className="min-w-0 flex-1">
          <Composer />
        </div>
        <button
          type="button"
          aria-label="Hide the composer"
          title="Hide the composer (⌘/)"
          onClick={toggleCollapsed}
          className="mb-2 grid size-7 shrink-0 place-items-center rounded-full text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 hover:text-foreground"
        >
          <ChevronDownIcon className="size-4" />
        </button>
      </div>
    </div>
  );
}

/** The composer put away: one dot. It still reports a running turn, because a
 * collapsed surface must not make the agent invisible. */
function CollapsedDot({ busy, onExpand }: { busy: boolean; onExpand: () => void }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-7 z-30 flex justify-center pb-4">
      <button
        type="button"
        aria-label={busy ? "Show the composer — the agent is working" : "Show the composer"}
        title="Show the composer (⌘/)"
        onClick={onExpand}
        className={cn(
          "pointer-events-auto grid size-9 place-items-center rounded-full border border-border bg-background text-muted-foreground shadow-surface-2 transition-colors hover:text-foreground",
          busy && "text-foreground",
        )}
      >
        <SparklesIcon className={cn("size-4", busy && "animate-pulse")} />
      </button>
    </div>
  );
}
