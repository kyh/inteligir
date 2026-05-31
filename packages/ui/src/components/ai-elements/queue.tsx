"use client";

import type { ComponentProps } from "react";

import { cn } from "@repo/ui/lib/utils";

export type QueueItemProps = ComponentProps<"li">;

export const QueueItem = ({ className, ...props }: QueueItemProps) => (
  <li
    className={cn(
      "group flex flex-col gap-1 rounded-md px-3 py-1 text-sm transition-colors hover:bg-muted",
      className,
    )}
    {...props}
  />
);

export type QueueItemIndicatorProps = ComponentProps<"span"> & {
  completed?: boolean;
};

export const QueueItemIndicator = ({
  completed = false,
  className,
  ...props
}: QueueItemIndicatorProps) => (
  <span
    className={cn(
      "mt-0.5 inline-block size-2.5 rounded-full border",
      completed
        ? "border-muted-foreground/20 bg-muted-foreground/10"
        : "border-muted-foreground/50",
      className,
    )}
    {...props}
  />
);

export type QueueItemContentProps = ComponentProps<"span"> & {
  completed?: boolean;
};

export const QueueItemContent = ({
  completed = false,
  className,
  ...props
}: QueueItemContentProps) => (
  <span
    className={cn(
      "line-clamp-1 grow break-words",
      completed ? "text-muted-foreground/50 line-through" : "text-muted-foreground",
      className,
    )}
    {...props}
  />
);

export type QueueListProps = ComponentProps<"div">;

// Plain overflow-auto wrapper in place of the upstream's ScrollArea — this
// repo doesn't ship a ScrollArea primitive and the visual fallback is fine.
export const QueueList = ({ children, className, ...props }: QueueListProps) => (
  <div className={cn("mt-2 -mb-1 overflow-auto", className)} {...props}>
    <div className="max-h-40 pr-4">
      <ul>{children}</ul>
    </div>
  </div>
);

export type QueueProps = ComponentProps<"div">;

export const Queue = ({ className, ...props }: QueueProps) => (
  <div
    className={cn(
      "flex flex-col gap-2 rounded-xl border border-border bg-background px-3 pb-2 pt-2 shadow-xs",
      className,
    )}
    {...props}
  />
);
