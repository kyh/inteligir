"use client";
// Vendored from Fluid Functionalism (github.com/mickadesign/fluid-functionalism), MIT.

// Scroll area built on Base UI — radius-aware scrollbar, native overflow
// fallback on touch-primary devices. Scrollbar
// machinery adapted from Lina by SameerJS6 (https://lina.sameer.sh); built on
// @base-ui/react/scroll-area, whose scrollbars stay mounted while scrollable
// and expose hover/scroll state as data attributes instead of Radix's
// show/hide presence animation.

import { forwardRef, type ComponentPropsWithoutRef, type ComponentRef } from "react";
import { ScrollArea as ScrollAreaPrimitive } from "@base-ui/react/scroll-area";
import { cn } from "@repo/ui/lib/utils";
import { useRadius } from "@repo/ui/lib/radius-context";
import { useTouchPrimary } from "@repo/ui/hooks/use-touch-primary";

interface ScrollAreaProps extends ComponentPropsWithoutRef<"div"> {
  /** `| undefined` spelled out so a caller may forward its own optional prop
   *  under exactOptionalPropertyTypes. */
  viewportClassName?: string | undefined;
}

const ScrollArea = forwardRef<ComponentRef<typeof ScrollAreaPrimitive.Root>, ScrollAreaProps>(
  ({ className, children, viewportClassName, ...props }, ref) => {
    // On touch-primary devices the Base UI machinery is skipped entirely in
    // favour of native overflow scrolling (better physics, momentum,
    // rubber-banding).
    const isTouch = useTouchPrimary();

    if (isTouch) {
      return (
        <div
          ref={ref}
          role="group"
          data-slot="scroll-area"
          aria-roledescription="scroll area"
          className={cn("relative overflow-hidden", className)}
          {...props}
        >
          <div
            data-slot="scroll-area-viewport"
            className={cn("size-full overflow-y-auto rounded-[inherit]", viewportClassName)}
            tabIndex={0}
          >
            {children}
          </div>
        </div>
      );
    }

    // Content gives Base UI an intrinsic size to measure overflow against.
    return (
      <ScrollAreaPrimitive.Root
        ref={ref}
        data-slot="scroll-area"
        className={cn("relative overflow-hidden", className)}
        {...props}
      >
        <ScrollAreaPrimitive.Viewport
          data-slot="scroll-area-viewport"
          className={cn("size-full rounded-[inherit]", viewportClassName)}
        >
          <ScrollAreaPrimitive.Content>{children}</ScrollAreaPrimitive.Content>
        </ScrollAreaPrimitive.Viewport>
        <ScrollBar />
      </ScrollAreaPrimitive.Root>
    );
  },
);

ScrollArea.displayName = "ScrollArea";

function ScrollBar({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.Scrollbar>) {
  const radius = useRadius();

  return (
    <ScrollAreaPrimitive.Scrollbar
      orientation="vertical"
      data-slot="scroll-area-scrollbar"
      // Base UI keeps the scrollbar mounted while scrollable; visibility is
      // a plain opacity transition off its hover/scroll state attributes,
      // matching the cue fade — 160ms in, 120ms out (exits faster, per the
      // animation guidelines); spring tokens are framer-motion configs and
      // don't apply here.
      className={cn(
        // The 10px track stays as a comfortable hit target; the thumb inside
        // it rests narrow and low-contrast, then widens + darkens on hover so
        // it gets out of the way until you reach for it.
        "group/scrollbar absolute top-0 right-0 z-20 flex h-full w-2.5 touch-none select-none",
        // Show immediately; on hide, wait out the 150ms thumb shrink before
        // fading so the thumb visibly narrows back first instead of the fade
        // masking it.
        "opacity-0 transition-opacity duration-120 ease-out delay-160",
        "data-[hovering]:duration-160 data-[scrolling]:duration-160",
        "data-[hovering]:opacity-100 data-[scrolling]:opacity-100",
        "data-[hovering]:delay-0 data-[scrolling]:delay-0",
        className,
      )}
      {...props}
    >
      <ScrollAreaPrimitive.Thumb
        data-slot="scroll-area-thumb"
        className={cn(
          // Fixed surface-relative overlay ramp (8 → 12 → 16%) — same tint
          // direction as the menu hover/active tokens, one notch stronger.
          "relative bg-[rgb(var(--overlay)/0.08)] transition-[background-color,width,height] duration-160 ease-in-out",
          "group-hover/scrollbar:bg-[rgb(var(--overlay)/0.12)] active:!bg-[rgb(var(--overlay)/0.16)]",
          radius.bg,
          // -translate nudges the thumb 2px off the container edge; the track
          // (and its 10px hit target) stays flush so edge-throws still land.
          "mx-auto my-1 w-1 -translate-x-0.5 h-[var(--scroll-area-thumb-height)] group-hover/scrollbar:w-1.5",
        )}
      />
    </ScrollAreaPrimitive.Scrollbar>
  );
}

export { ScrollArea };
