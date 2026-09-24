"use client";
// Vendored from shadcn/ui (github.com/shadcn-ui/ui), MIT.

import * as React from "react";
import type { HTMLProps } from "react";
import { Popover as PopoverPrimitive } from "@base-ui/react/popover";

import { cn } from "@repo/ui/lib/cn";
import { Elevated } from "@repo/ui/lib/elevated";
import { motionProps, motionStyle } from "@repo/ui/lib/motion-style";

const Popover = ({ ...props }: PopoverPrimitive.Root.Props) => (
  <PopoverPrimitive.Root data-slot="popover" {...props} />
);

const PopoverTrigger = ({ ...props }: PopoverPrimitive.Trigger.Props) => (
  <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />
);

// the Popup itself is the surface, on the menus' rung, so a popover and a menu are one level;
// bloom-popup's CSS stays its motion
const renderSurface = (popupProps: HTMLProps<HTMLDivElement>) => {
  const { style, ...rest } = motionProps(popupProps);
  return <Elevated {...rest} offset={2} shadowLevel={3} style={motionStyle(style)} />;
};

const PopoverContent = ({
  className,
  align = "center",
  alignOffset = 0,
  side = "bottom",
  sideOffset = 4,
  anchor,
  ...props
}: PopoverPrimitive.Popup.Props &
  Pick<
    PopoverPrimitive.Positioner.Props,
    "align" | "alignOffset" | "side" | "sideOffset" | "anchor"
  >) => (
  <PopoverPrimitive.Portal>
    <PopoverPrimitive.Positioner
      align={align}
      alignOffset={alignOffset}
      side={side}
      sideOffset={sideOffset}
      anchor={anchor}
      className="isolate z-50"
    >
      <PopoverPrimitive.Popup
        data-slot="popover-content"
        className={cn(
          "bloom-popup z-50 flex w-72 origin-(--transform-origin) flex-col gap-4 rounded-3xl p-4 text-subtitle text-popover-foreground outline-hidden",
          className,
        )}
        render={renderSurface}
        {...props}
      />
    </PopoverPrimitive.Positioner>
  </PopoverPrimitive.Portal>
);

export { Popover, PopoverContent, PopoverTrigger };
