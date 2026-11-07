"use client";
// Vendored from Beautiful UI (beautifului.dev), MIT.

import { useEffect, useState } from "react";
import type { HTMLAttributes, RefAttributes } from "react";

import { cn } from "@repo/ui/lib/cn";

const WORD_MS = 55;

// keeps the separators so a re-joined prefix is byte-faithful
const splitWords = (text: string): string[] =>
  text.length === 0 ? [] : text.split(/(?<separator>\s+)/u).filter((part) => part.length > 0);

type TextFrameProps = Omit<HTMLAttributes<HTMLDivElement>, "children">;

interface StreamingFrameProps extends TextFrameProps {
  shown: string;
  caret: boolean;
}

const StreamingFrame = ({
  shown,
  caret,
  className,
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
  </div>
);

interface StreamingTextProps extends TextFrameProps {
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

export { StreamingText };
