"use client";
// Vendored from Fluid Functionalism (github.com/mickadesign/fluid-functionalism), MIT.

// Scrollbar machinery adapted from Lina by SameerJS6 (https://lina.sameer.sh).

import { forwardRef, type ComponentPropsWithoutRef, type ComponentRef } from "react";
import { ScrollArea as ScrollAreaPrimitive } from "@base-ui/react/scroll-area";
import { cn } from "cn";
import { useRadius } from "@repo/ui/lib/radius-context";
import { useTouchPrimary } from "@repo/ui/hooks/use-touch-primary";

type ScrollAreaProps = ComponentPropsWithoutRef<"div">;

const ScrollArea = forwardRef<ComponentRef<typeof ScrollAreaPrimitive.Root>, ScrollAreaProps>(
  ({ className, children, ...props }, ref) => {
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
            className="size-full overflow-y-auto rounded-[inherit]"
            tabIndex={0}
          >
            {children}
          </div>
        </div>
      );
    }

    return (
      <ScrollAreaPrimitive.Root
        ref={ref}
        data-slot="scroll-area"
        className={cn("relative overflow-hidden", className)}
        {...props}
      >
        <ScrollAreaPrimitive.Viewport
          data-slot="scroll-area-viewport"
          className="size-full rounded-[inherit]"
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
      // Base UI keeps the scrollbar mounted; visibility is an opacity transition off its data
      // attributes, not a presence animation
      className={cn(
        "group/scrollbar absolute top-0 right-0 z-20 flex h-full w-2.5 touch-none select-none",
        // the hide delay waits out the thumb's 150ms shrink so it visibly narrows before fading
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
          "relative bg-[rgb(var(--overlay)/0.08)] transition-[background-color,width,height] duration-160 ease-in-out",
          "group-hover/scrollbar:bg-[rgb(var(--overlay)/0.12)] active:!bg-[rgb(var(--overlay)/0.16)]",
          radius.bg,
          // the thumb is nudged off the edge, never the track, so edge-throws still land
          "mx-auto my-1 w-1 -translate-x-0.5 h-[var(--scroll-area-thumb-height)] group-hover/scrollbar:w-1.5",
        )}
      />
    </ScrollAreaPrimitive.Scrollbar>
  );
}

export { ScrollArea };
