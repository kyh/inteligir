"use client";
// Vendored from Fluid Functionalism (github.com/mickadesign/fluid-functionalism), MIT.

import * as React from "react";
import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";
import { motion, useMotionValue } from "framer-motion";

import { cn } from "@repo/ui/lib/utils";
import { motionProps, motionStyle } from "@repo/ui/lib/motion-style";
import { fontWeights } from "@repo/ui/lib/font-weight";
import { useRadius } from "@repo/ui/lib/radius-context";
import { spring } from "@repo/ui/lib/springs";

const DEFAULT_DELAY = 200;
const SKIP_DELAY_TIMEOUT = 300;

// a per-instance Provider would defeat cross-tooltip skip-delay grouping, so a Tooltip wraps
// itself only when no app-level TooltipProvider is above it
const TooltipGroupContext = React.createContext(false);

interface TooltipProviderProps {
  children: React.ReactNode;
  delay?: number;
}

function TooltipProvider({ children, delay = DEFAULT_DELAY }: TooltipProviderProps) {
  return (
    <TooltipGroupContext.Provider value={true}>
      <TooltipPrimitive.Provider delay={delay} timeout={SKIP_DELAY_TIMEOUT}>
        {children}
      </TooltipPrimitive.Provider>
    </TooltipGroupContext.Provider>
  );
}

type TooltipSide = "top" | "right" | "bottom" | "left";

interface TooltipProps {
  content: React.ReactNode;
  children: React.ReactElement;
  side?: TooltipSide;
  sideOffset?: number;
  delay?: number;
  className?: string;
  // `| undefined` is spelled out so a caller may pass it explicitly under exactOptionalPropertyTypes
  forceOpen?: boolean | undefined;
  followCursor?: "x" | "y";
  onOpenChange?: (open: boolean) => void;
}

function getSlideOffset(side: TooltipSide) {
  switch (side) {
    case "top":
      return { y: 4 };
    case "bottom":
      return { y: -4 };
    case "left":
      return { x: 4 };
    case "right":
      return { x: -4 };
  }
}

function Tooltip({
  content,
  children,
  side = "top",
  sideOffset = 8,
  delay,
  className,
  forceOpen,
  onOpenChange: onOpenChangeProp,
  followCursor,
}: TooltipProps) {
  const [internalOpen, setInternalOpen] = React.useState(false);
  const open = forceOpen !== undefined ? forceOpen : internalOpen;
  const radius = useRadius();
  const hasAmbientProvider = React.useContext(TooltipGroupContext);

  const slideOffset = getSlideOffset(side);

  // a motion value, not state, so per-move updates skip React re-renders
  const followOffset = useMotionValue(0);
  const handleFollowMove = (event: React.PointerEvent) => {
    if (!followCursor) return;
    const rect = event.currentTarget.getBoundingClientRect();
    followOffset.set(
      followCursor === "y"
        ? event.clientY - (rect.top + rect.height / 2)
        : event.clientX - (rect.left + rect.width / 2),
    );
  };

  const tooltip = (
    <TooltipPrimitive.Root
      open={open}
      onOpenChange={(v) => {
        setInternalOpen(v);
        onOpenChangeProp?.(v);
      }}
    >
      <TooltipPrimitive.Trigger
        render={children}
        delay={delay}
        onPointerMove={followCursor ? handleFollowMove : undefined}
      />
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Positioner side={side} sideOffset={sideOffset} className="z-50">
          <TooltipPrimitive.Popup
            render={(props, state) => {
              const exiting = state.transitionStatus === "ending";
              const { style: baseStyle, ...rest } = motionProps(props);
              const followStyle =
                followCursor === "y"
                  ? { y: followOffset }
                  : followCursor === "x"
                    ? { x: followOffset }
                    : undefined;
              // the cursor-follow transform and the enter/exit slide sit on separate elements so
              // they do not fight
              return (
                <motion.div {...rest} style={motionStyle(baseStyle, followStyle)}>
                  <motion.div
                    className={cn(
                      "bg-foreground text-background text-[12px] px-2 py-1",
                      "[text-box:trim-both_cap_alphabetic] supports-[text-box:trim-both]:py-2",
                      radius.bg,
                      className,
                    )}
                    style={{ fontVariationSettings: fontWeights.medium }}
                    initial={{ opacity: 0, ...slideOffset }}
                    animate={exiting ? { opacity: 0, ...slideOffset } : { opacity: 1, x: 0, y: 0 }}
                    transition={exiting ? spring.fast.exit : spring.fast}
                  >
                    {content}
                  </motion.div>
                </motion.div>
              );
            }}
          />
        </TooltipPrimitive.Positioner>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );

  if (hasAmbientProvider) return tooltip;

  return (
    <TooltipPrimitive.Provider delay={delay ?? DEFAULT_DELAY}>{tooltip}</TooltipPrimitive.Provider>
  );
}

export { Tooltip, TooltipProvider };
