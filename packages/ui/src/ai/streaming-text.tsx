"use client";
// Vendored from Beautiful UI (beautifului.dev), MIT.

import { useEffect, useRef, useState, type ReactNode } from "react";

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

export interface StreamingTextProps {
  /** The message so far. Growing it reveals the new words; shrinking resets. */
  text: string;
  /** True while more text may still arrive — draws the caret. */
  streaming?: boolean;
  /**
   * Reveal word-by-word. Off renders `text` whole — the right choice for
   * history, where a replayed typing animation is a lie about what is live.
   */
  animate?: boolean;
  /** Rendered under the text once nothing more is arriving. */
  actions?: ReactNode;
  className?: string;
}

export function StreamingText({
  text,
  streaming = false,
  animate = true,
  actions,
  className,
}: StreamingTextProps) {
  const words = splitWords(text);
  const [revealed, setRevealed] = useState(() => (animate ? 0 : words.length));
  // Revealing is a queue, not a subscription: the effect steps one word per
  // tick toward the current length instead of restarting on every prop change.
  const targetRef = useRef(words.length);
  targetRef.current = words.length;

  useEffect(() => {
    if (!animate) {
      setRevealed(targetRef.current);
      return;
    }
    // A shorter text is a different message (a retry, a switched thread);
    // clamping down keeps the reveal from reading past the end.
    setRevealed((current) => Math.min(current, targetRef.current));
    const timer = setInterval(() => {
      setRevealed((current) => (current >= targetRef.current ? current : current + 1));
    }, WORD_MS);
    return () => clearInterval(timer);
  }, [animate, text]);

  const shown = animate ? words.slice(0, revealed).join("") : text;
  const caret = streaming || revealed < words.length;

  return (
    <div className={cn("w-full", className)}>
      <p className="text-[13px] leading-relaxed whitespace-pre-wrap text-ink">
        {shown}
        {caret ? (
          <span
            aria-hidden
            className="ml-0.5 inline-block h-3 w-0.5 translate-y-0.5 animate-pulse rounded-full bg-ink"
          />
        ) : null}
      </p>

      {actions !== undefined && !caret ? (
        <div className="mt-2 flex items-center gap-0.5">{actions}</div>
      ) : null}
    </div>
  );
}

export interface StreamingActionProps {
  label: string;
  onClick: () => void;
  children: ReactNode;
}

/** The message-action affordance upstream draws beside a finished answer.
 *  Exported bare so a consumer supplies only the actions it can honour. */
export function StreamingAction({ label, onClick, children }: StreamingActionProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="flex size-6 items-center justify-center rounded-[6px] text-ink-3 transition-colors duration-100 hover:bg-hover hover:text-ink-2"
    >
      {children}
    </button>
  );
}
