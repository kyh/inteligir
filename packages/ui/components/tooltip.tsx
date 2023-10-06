"use client";

import * as Primitives from "@radix-ui/react-tooltip";
import * as React from "react";
import { cn } from "../lib/cn";

type TooltipProps = {
  content: React.ReactNode;
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
  side?: "bottom" | "left" | "top" | "right";
  maxWidth?: number;
} & Omit<Primitives.TooltipContentProps, "content" | "onClick"> &
  Pick<
    Primitives.TooltipProps,
    "open" | "defaultOpen" | "onOpenChange" | "delayDuration"
  >;

const Tooltip = ({
  children,
  content,
  open,
  defaultOpen,
  onOpenChange,
  delayDuration,
  maxWidth = 220,
  className,
  side,
  sideOffset = 8,
  onClick,
  ...props
}: TooltipProps) => {
  return (
    <Primitives.Provider delayDuration={100}>
      <Primitives.Root
        defaultOpen={defaultOpen}
        delayDuration={delayDuration}
        onOpenChange={onOpenChange}
        open={open}
      >
        <Primitives.Trigger asChild onClick={onClick}>
          {children}
        </Primitives.Trigger>
        <Primitives.Portal>
          <Primitives.Content
            align="center"
            className={cn(
              "rounded-lg bg-ui-bg-base px-3 py-2 text-xs text-ui-fg-subtle shadow-elevation-tooltip",
              "animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
              className,
            )}
            side={side}
            sideOffset={sideOffset}
            {...props}
            style={{ ...props.style, maxWidth }}
          >
            {content}
          </Primitives.Content>
        </Primitives.Portal>
      </Primitives.Root>
    </Primitives.Provider>
  );
};

export { Tooltip };
