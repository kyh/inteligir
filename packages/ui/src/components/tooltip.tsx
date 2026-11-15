"use client";
// Vendored from Fluid Functionalism (github.com/mickadesign/fluid-functionalism), MIT.

import * as React from "react";
import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";
import { motion, useMotionValue } from "motion/react";
import type { MotionStyle } from "motion/react";

import { cn } from "@repo/ui/lib/cn";
import { motionProps, motionStyle } from "@repo/ui/lib/motion-style";
import { PopupOpen, PopupPresence } from "@repo/ui/lib/popup-presence";
import { fontWeights } from "@repo/ui/lib/font-weight";
import { radius } from "@repo/ui/lib/radius";
import { spring } from "@repo/ui/lib/springs";

const DEFAULT_DELAY = 200;
const SKIP_DELAY_TIMEOUT = 300;

// groups the tooltips under it, so one opens at once after its neighbour; each trigger carries
// its own delay, so a tooltip with no provider above it waits the same
const TooltipProvider = ({ children }: { children: React.ReactNode }) => (
  <TooltipPrimitive.Provider timeout={SKIP_DELAY_TIMEOUT}>{children}</TooltipPrimitive.Provider>
);

type TooltipSide = "top" | "right" | "bottom" | "left";

interface TooltipProps {
  content: React.ReactNode;
  children: React.ReactElement;
  side?: TooltipSide;
  sideOffset?: number;
  delay?: number;
  className?: string;
  disabled?: boolean;
  followCursor?: "x" | "y";
}

const slideOffsets: Record<TooltipSide, { x: number } | { y: number }> = {
  bottom: { y: -4 },
  left: { x: 4 },
  right: { x: -4 },
  top: { y: 4 },
};

const Tooltip = ({
  content,
  children,
  side = "top",
  sideOffset = 8,
  delay = DEFAULT_DELAY,
  className,
  disabled = false,
  followCursor,
}: TooltipProps) => {
  const [open, setOpen] = React.useState(false);

  const slideOffset = slideOffsets[side];

  // a motion value, not state, so per-move updates skip React re-renders
  const followOffset = useMotionValue(0);
  const handleFollowMove = (event: React.PointerEvent) => {
    if (!followCursor) {
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    followOffset.set(
      followCursor === "y"
        ? event.clientY - (rect.top + rect.height / 2)
        : event.clientX - (rect.left + rect.width / 2),
    );
  };

  return (
    <TooltipPrimitive.Root open={open} onOpenChange={setOpen} disabled={disabled}>
      <TooltipPrimitive.Trigger
        render={children}
        delay={delay}
        onPointerMove={followCursor ? handleFollowMove : undefined}
      />
      <PopupOpen open={open && !disabled}>
        <PopupPresence>
          <TooltipPrimitive.Portal keepMounted>
            <TooltipPrimitive.Positioner side={side} sideOffset={sideOffset} className="z-50">
              <TooltipPrimitive.Popup
                render={(props) => {
                  const { style: baseStyle, ...rest } = motionProps(props);
                  let followStyle: MotionStyle | undefined;
                  if (followCursor === "y") {
                    followStyle = { y: followOffset };
                  } else if (followCursor === "x") {
                    followStyle = { x: followOffset };
                  }
                  // the enter/exit slide rides the Popup element, the one Base UI waits on before
                  // it unmounts; the cursor-follow transform sits on the child so the two do not
                  // fight
                  return (
                    <motion.div
                      {...rest}
                      style={motionStyle(baseStyle)}
                      initial={{ opacity: 0, ...slideOffset }}
                      animate={{ opacity: 1, transition: spring.fast, x: 0, y: 0 }}
                      exit={{ opacity: 0, ...slideOffset, transition: spring.fast.exit }}
                    >
                      <motion.div
                        className={cn(
                          "bg-foreground text-background text-body px-2 py-1",
                          "[text-box:trim-both_cap_alphabetic] supports-[text-box:trim-both]:py-2",
                          radius.bg,
                          className,
                        )}
                        style={motionStyle(
                          { fontVariationSettings: fontWeights.medium },
                          followStyle,
                        )}
                      >
                        {content}
                      </motion.div>
                    </motion.div>
                  );
                }}
              />
            </TooltipPrimitive.Positioner>
          </TooltipPrimitive.Portal>
        </PopupPresence>
      </PopupOpen>
    </TooltipPrimitive.Root>
  );
};

export { Tooltip, TooltipProvider };
