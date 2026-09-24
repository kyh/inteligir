"use client";
// Vendored from shadcn/ui (github.com/shadcn-ui/ui), MIT.

import * as React from "react";
import type { HTMLProps } from "react";
import { PreviewCard as HoverCardPrimitive } from "@base-ui/react/preview-card";

import { cn } from "@repo/ui/lib/cn";
import { Elevated } from "@repo/ui/lib/elevated";
import { motionProps, motionStyle } from "@repo/ui/lib/motion-style";

const HoverCard = ({ ...props }: HoverCardPrimitive.Root.Props) => (
  <HoverCardPrimitive.Root data-slot="hover-card" {...props} />
);

const HoverCardTrigger = ({ ...props }: HoverCardPrimitive.Trigger.Props) => (
  <HoverCardPrimitive.Trigger data-slot="hover-card-trigger" {...props} />
);

// the Popup itself is the surface, on the menus' rung, so a card and a menu are one level;
// bloom-popup's CSS stays its motion
const renderSurface = (popupProps: HTMLProps<HTMLDivElement>) => {
  const { style, ...rest } = motionProps(popupProps);
  return <Elevated {...rest} offset={2} shadowLevel={3} style={motionStyle(style)} />;
};

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
          "bloom-popup z-50 w-80 origin-(--transform-origin) rounded-2xl p-3 text-subtitle text-popover-foreground outline-hidden",
          className,
        )}
        render={renderSurface}
        {...props}
      />
    </HoverCardPrimitive.Positioner>
  </HoverCardPrimitive.Portal>
);

export { HoverCard, HoverCardContent, HoverCardTrigger };
