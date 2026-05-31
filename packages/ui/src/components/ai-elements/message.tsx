"use client";

import type { HTMLAttributes } from "react";
import type { UIMessage } from "ai";

import { cn } from "@repo/ui/lib/utils";

export type MessageProps = HTMLAttributes<HTMLDivElement> & {
  from: UIMessage["role"];
};

export const Message = ({ className, from, ...props }: MessageProps) => (
  <div
    className={cn(
      "group flex w-full max-w-[95%] flex-col gap-2",
      from === "user" ? "is-user ml-auto justify-end" : "is-assistant",
      className,
    )}
    {...props}
  />
);

export type MessageContentProps = HTMLAttributes<HTMLDivElement>;

export const MessageContent = ({ children, className, ...props }: MessageContentProps) => (
  <div
    className={cn(
      "flex w-fit min-w-0 max-w-full flex-col gap-2 overflow-hidden text-sm",
      "group-[.is-user]:ml-auto group-[.is-user]:rounded-lg group-[.is-user]:bg-foreground/20 group-[.is-user]:px-4 group-[.is-user]:py-3 group-[.is-user]:text-foreground group-[.is-user]:backdrop-blur-sm",
      "group-[.is-assistant]:rounded-lg group-[.is-assistant]:bg-foreground/10 group-[.is-assistant]:px-4 group-[.is-assistant]:py-3 group-[.is-assistant]:text-foreground group-[.is-assistant]:backdrop-blur-sm",
      className,
    )}
    {...props}
  >
    {children}
  </div>
);
