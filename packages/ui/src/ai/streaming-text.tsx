"use client";
// @license MIT, vendored from Beautiful UI (beautifului.dev).

import type { HTMLAttributes, RefAttributes } from "react";

import { cn } from "@repo/ui/lib/cn";

interface StreamingTextProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  text: string;
  streaming?: boolean;
}

const StreamingText = ({
  text,
  streaming = false,
  className,
  ref,
  ...props
}: StreamingTextProps & RefAttributes<HTMLDivElement>) => (
  <div ref={ref} data-slot="streaming-text" className={cn("w-full", className)} {...props}>
    <p className="text-subtitle leading-relaxed whitespace-pre-wrap text-foreground">
      {text}
      {streaming ? (
        <span
          aria-hidden
          className="ml-0.5 inline-block h-3 w-0.5 translate-y-0.5 animate-pulse rounded-full bg-foreground"
        />
      ) : null}
    </p>
  </div>
);

export { StreamingText };
