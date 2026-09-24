"use client";
// Vendored from Beautiful UI (beautifului.dev), MIT.

import { useEffect, useState } from "react";
import type { HTMLAttributes, RefAttributes } from "react";

import { cn } from "@repo/ui/lib/cn";

const WORD_MS = 55;

// keeps the separators so a re-joined prefix is byte-faithful
const splitWords = (text: string): string[] =>
  text.length === 0 ? [] : text.split(/(?<separator>\s+)/u).filter((part) => part.length > 0);

interface StreamingFrameProps extends HTMLAttributes<HTMLDivElement> {
  shown: string;
  caret: boolean;
}

// actions wait for the text to settle: one offered mid-stream acts on a moving message
const StreamingFrame = ({
  shown,
  caret,
  className,
  children,
  ref,
  ...props
}: StreamingFrameProps & RefAttributes<HTMLDivElement>) => (
  <div ref={ref} data-slot="streaming-text" className={cn("w-full", className)} {...props}>
    <p className="text-subtitle leading-relaxed whitespace-pre-wrap text-ink">
      {shown}
      {caret ? (
        <span
          aria-hidden
          className="ml-0.5 inline-block h-3 w-0.5 translate-y-0.5 animate-pulse rounded-full bg-ink"
        />
      ) : null}
    </p>

    {children !== undefined && !caret ? (
      <div data-slot="streaming-text-actions" className="mt-2 flex items-center gap-0.5">
        {children}
      </div>
    ) : null}
  </div>
);

interface StreamingTextProps extends HTMLAttributes<HTMLDivElement> {
  text: string;
  streaming?: boolean;
  animate?: boolean;
}

type AnimatedTextProps = Omit<StreamingTextProps, "animate" | "streaming"> & { streaming: boolean };

const AnimatedText = ({
  text,
  streaming,
  ...frame
}: AnimatedTextProps & RefAttributes<HTMLDivElement>) => {
  const words = splitWords(text);
  const target = words.length;
  const [revealed, setRevealed] = useState(0);

  // a shorter text is a different message: clamp before the reveal queue is read
  if (revealed > target) {
    setRevealed(target);
  }
  const catchingUp = revealed < target;

  useEffect(() => {
    if (!catchingUp) {
      return;
    }
    const timer = setInterval(() => {
      setRevealed((current) => (current >= target ? current : current + 1));
    }, WORD_MS);
    return () => {
      clearInterval(timer);
    };
  }, [target, catchingUp]);

  return (
    <StreamingFrame
      shown={words.slice(0, revealed).join("")}
      caret={streaming || catchingUp}
      {...frame}
    />
  );
};

// branches before any hook: a caller that grows the text itself pays for no word split and no timer
const StreamingText = ({
  text,
  streaming = false,
  animate = true,
  ...frame
}: StreamingTextProps & RefAttributes<HTMLDivElement>) =>
  animate ? (
    <AnimatedText text={text} streaming={streaming} {...frame} />
  ) : (
    <StreamingFrame shown={text} caret={streaming} {...frame} />
  );
StreamingText.displayName = "StreamingText";

interface StreamingActionProps extends HTMLAttributes<HTMLButtonElement> {
  label: string;
}

const StreamingAction = ({
  label,
  className,
  children,
  ref,
  ...props
}: StreamingActionProps & RefAttributes<HTMLButtonElement>) => (
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
);
StreamingAction.displayName = "StreamingAction";

export { StreamingText, StreamingAction };
