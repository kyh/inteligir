"use client";
// Vendored from Beautiful UI (beautifului.dev), MIT.

import { forwardRef, useEffect, useState, type HTMLAttributes } from "react";

import { cn } from "@repo/ui/lib/utils";

/* ─────────────────────────────────────────────────────────
 * STREAMING TEXT
 * Words resolve one at a time behind a caret, then the
 * message's actions become usable.
 *
 * Upstream cycles a canned token array on a timer. Here the
 * TEXT IS THE INPUT: newly-arrived words reveal at the same
 * cadence, so a provider that emits a paragraph in one chunk
 * still reads as typing, and a re-render never rewinds what
 * the reader already saw.
 * ───────────────────────────────────────────────────────── */

const WORD_MS = 55;

/** Split keeping the separators, so re-joining a prefix is byte-faithful. */
function splitWords(text: string): string[] {
  return text.length === 0 ? [] : text.split(/(\s+)/u).filter((part) => part.length > 0);
}

interface StreamingTextProps extends HTMLAttributes<HTMLDivElement> {
  /** The message so far. Growing it reveals the new words; shrinking resets. */
  text: string;
  /** True while more text may still arrive — draws the caret. */
  streaming?: boolean;
  /**
   * Reveal word-by-word. Off renders `text` whole — the right choice for
   * history, where a replayed typing animation is a lie about what is live.
   */
  animate?: boolean;
}

const StreamingText = forwardRef<HTMLDivElement, StreamingTextProps>(
  ({ text, streaming = false, animate = true, className, children, ...props }, ref) => {
    const words = splitWords(text);
    const target = words.length;
    const [revealed, setRevealed] = useState(() => (animate ? 0 : target));

    // Revealing is a queue, not a subscription: the interval steps one word per
    // tick toward the current length instead of re-deriving the reveal from the
    // prop. Two cases still have to be corrected before the queue is read — a
    // shorter text is a different message (a retry, a switched thread) and the
    // reveal must not read past its end, and turning the animation off shows
    // everything at once.
    if (revealed > target || (!animate && revealed !== target)) {
      setRevealed(target);
    }

    useEffect(() => {
      if (!animate) return;
      const timer = setInterval(() => {
        setRevealed((current) => (current >= target ? current : current + 1));
      }, WORD_MS);
      return () => clearInterval(timer);
    }, [animate, target]);

    const shown = animate ? words.slice(0, revealed).join("") : text;
    const caret = streaming || revealed < target;

    return (
      <div ref={ref} data-slot="streaming-text" className={cn("w-full", className)} {...props}>
        <p className="text-[13px] leading-relaxed whitespace-pre-wrap text-ink">
          {shown}
          {caret ? (
            <span
              aria-hidden
              className="ml-0.5 inline-block h-3 w-0.5 translate-y-0.5 animate-pulse rounded-full bg-ink"
            />
          ) : null}
        </p>

        {/* Actions compose as children and wait for the text to settle: an
            action offered mid-stream acts on a message that is still moving. */}
        {children !== undefined && !caret ? (
          <div data-slot="streaming-text-actions" className="mt-2 flex items-center gap-0.5">
            {children}
          </div>
        ) : null}
      </div>
    );
  },
);
StreamingText.displayName = "StreamingText";

interface StreamingActionProps extends HTMLAttributes<HTMLButtonElement> {
  label: string;
}

const StreamingAction = forwardRef<HTMLButtonElement, StreamingActionProps>(
  ({ label, className, children, ...props }, ref) => (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={label}
      data-slot="streaming-action"
      className={cn(
        "flex size-7 items-center justify-center rounded-md text-ink-3 transition-colors duration-100 hover:bg-hover hover:text-ink",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  ),
);
StreamingAction.displayName = "StreamingAction";

export { StreamingText, StreamingAction };
