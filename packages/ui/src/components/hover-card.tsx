"use client";
// Vendored from shadcn/ui (github.com/shadcn-ui/ui), MIT.

import * as React from "react";
import { PreviewCard as HoverCardPrimitive } from "@base-ui/react/preview-card";

import { cn } from "cn";

const HoverCard = ({ ...props }: HoverCardPrimitive.Root.Props) => (
  <HoverCardPrimitive.Root data-slot="hover-card" {...props} />
);

const HoverCardTrigger = ({ ...props }: HoverCardPrimitive.Trigger.Props) => (
  <HoverCardPrimitive.Trigger data-slot="hover-card-trigger" {...props} />
);

const HoverCardContent = ({
  className,
  align = "start",
  alignOffset = 0,
  side = "bottom",
  sideOffset = 6,
  ...props
}: HoverCardPrimitive.Popup.Props &
  Pick<HoverCardPrimitive.Positioner.Props, "align" | "alignOffset" | "side" | "sideOffset">) => (
  <HoverCardPrimitive.Portal>
    <HoverCardPrimitive.Positioner
      align={align}
      alignOffset={alignOffset}
      side={side}
      sideOffset={sideOffset}
      className="isolate z-50"
    >
      <HoverCardPrimitive.Popup
        data-slot="hover-card-content"
        className={cn(
          "bloom-popup z-50 w-80 origin-(--transform-origin) rounded-2xl bg-popover p-3 text-subtitle text-popover-foreground shadow-lg ring-1 ring-foreground/5 outline-hidden dark:ring-foreground/10",
          className,
        )}
        {...props}
      />
    </HoverCardPrimitive.Positioner>
  </HoverCardPrimitive.Portal>
);

export { HoverCard, HoverCardContent, HoverCardTrigger };
