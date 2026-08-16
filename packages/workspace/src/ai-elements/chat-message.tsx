"use client";

import type { ReactNode } from "react";
import { motion, type HTMLMotionProps } from "framer-motion";

import { Bubble, BubbleContent } from "@repo/ui/components/bubble";
import { Message, MessageContent } from "@repo/ui/components/message";
import { cn } from "@repo/ui/lib/utils";

// Entrance tween for a new transcript entry.
const entranceSpring = { type: "spring", duration: 0.16, bounce: 0.08 } as const;

interface ChatMessageProps extends Omit<HTMLMotionProps<"div">, "children"> {
  /** Who sent the message. Drives alignment and bubble treatment:
   *  `user` → right-aligned filled bubble, `assistant` → left-aligned plain text. */
  from: "user" | "assistant";
  /** Message body. When omitted the text bubble is dropped (attachment-only message). */
  children?: ReactNode;
}

// ─── ChatMessage ──────────────────────────────────────────────────────────
// A single transcript entry: the entrance/layout motion wrapper (the app's
// deliberate animation layer) over the stock shadcn Message/Bubble chat
// blocks, which own alignment and bubble chrome. `layout="position"` lets
// earlier messages slide up smoothly when a new one is appended.
function ChatMessage({ from, children, className, ...props }: ChatMessageProps) {
  const isUser = from === "user";

  return (
    <motion.div
      layout="position"
      initial={{ opacity: 0, y: 8, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={entranceSpring}
      style={{ transformOrigin: isUser ? "bottom right" : "bottom left" }}
      className={cn("w-full", className)}
      {...props}
    >
      {children != null && children !== "" && (
        <Message align={isUser ? "end" : "start"}>
          <MessageContent>
            <Bubble variant={isUser ? "secondary" : "ghost"} align={isUser ? "end" : "start"}>
              <BubbleContent
                className={cn(
                  "whitespace-pre-wrap",
                  // `text-pretty` is reserved for settled user bubbles. On the
                  // assistant reply it's left off on purpose: `text-wrap: pretty`
                  // re-balances the last lines on every content change, so a
                  // word-by-word stream visibly reflows earlier words to new
                  // lines. Default (normal) wrapping appends left-to-right and
                  // stays put as the text grows.
                  isUser && "text-pretty",
                )}
              >
                {children}
              </BubbleContent>
            </Bubble>
          </MessageContent>
        </Message>
      )}
    </motion.div>
  );
}

export { ChatMessage };
