"use client";

import { forwardRef, type ReactNode, type HTMLAttributes } from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { motion } from "framer-motion";
import { cn } from "@repo/ui/lib/utils";
import { useIcon } from "@repo/ui/lib/icon-context";
import { spring } from "@repo/ui/lib/springs";
import { useShape } from "@repo/ui/lib/shape-context";
import { SurfaceProvider, useSurface } from "@repo/ui/lib/surface-context";
import { surfaceClasses } from "@repo/ui/lib/surface-classes";
import { toMotionStyle } from "@repo/ui/lib/motion-style";
import { Button } from "@repo/ui/components/button";

const DIALOG_OFFSET = 4;

interface DialogProps {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  modal?: boolean;
  children?: ReactNode;
}

function Dialog({ children, open, defaultOpen, onOpenChange, modal }: DialogProps) {
  // Base UI's Root handles controlled/uncontrolled state internally. We only
  // narrow the (open, eventDetails) callback to (open) for our public prop.
  return (
    <DialogPrimitive.Root
      open={open}
      defaultOpen={defaultOpen}
      onOpenChange={(next) => onOpenChange?.(next)}
      modal={modal}
    >
      {children}
    </DialogPrimitive.Root>
  );
}

const DialogTrigger = DialogPrimitive.Trigger;
const DialogClose = DialogPrimitive.Close;

interface DialogContentProps extends HTMLAttributes<HTMLDivElement> {
  size?: "sm" | "lg";
}

const DialogContent = forwardRef<HTMLDivElement, DialogContentProps>(
  ({ className, children, size = "sm", ...props }, ref) => {
    const XIcon = useIcon("x");
    const shape = useShape();
    const substrate = useSurface();
    const dialogLevel = Math.min(substrate + DIALOG_OFFSET, 8);

    // No `if (!open) return null` here — Base UI's `<DialogPrimitive.Popup>`
    // handles mount/unmount itself, and waits for the framer-motion opacity
    // tween below to finish (via `element.getAnimations()`) before unmounting.
    // Returning null early would short-circuit the closing animation.
    return (
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop
          render={(backdropProps: React.HTMLAttributes<HTMLDivElement>, state) => {
            const exiting = state.transitionStatus === "ending";
            const {
              style: _style,
              onDrag: _onDrag,
              onDragStart: _onDragStart,
              onDragEnd: _onDragEnd,
              onAnimationStart: _onAnimationStart,
              onAnimationEnd: _onAnimationEnd,
              onAnimationIteration: _onAnimationIteration,
              ...rest
            } = backdropProps;
            return (
              <motion.div
                {...rest}
                className="fixed inset-0 z-50 bg-black/40 dark:bg-black/80"
                initial={{ opacity: 0 }}
                animate={{ opacity: exiting ? 0 : 1 }}
                transition={exiting ? spring.slow.exit : spring.slow}
              />
            );
          }}
        />
        <DialogPrimitive.Popup
          ref={ref}
          render={(popupProps: React.HTMLAttributes<HTMLDivElement>, state) => {
            const exiting = state.transitionStatus === "ending";
            const {
              style: baseStyle,
              onDrag: _onDrag,
              onDragStart: _onDragStart,
              onDragEnd: _onDragEnd,
              onAnimationStart: _onAnimationStart,
              onAnimationEnd: _onAnimationEnd,
              onAnimationIteration: _onAnimationIteration,
              ...rest
            } = popupProps;
            // Same object reference is spread at runtime, so behavior matches
            // `{...props}`; the annotation only hides the framer-motion-
            // incompatible React handler types from the motion.div spread.
            const consumerProps: Omit<
              React.HTMLAttributes<HTMLDivElement>,
              | "onDrag"
              | "onDragStart"
              | "onDragEnd"
              | "onAnimationStart"
              | "onAnimationEnd"
              | "onAnimationIteration"
            > = props;
            return (
              <motion.div
                // Base UI's props first (data attrs, refs, role, etc.)…
                {...rest}
                // …then the consumer's `<DialogContent>` props (className,
                // event handlers, data-*, etc.) land on the visible motion.div
                // — matching the Radix flavour, which spreads `...props` onto
                // the Content primitive that becomes the motion.div via asChild.
                {...consumerProps}
                className={cn(
                  "fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)]",
                  surfaceClasses(dialogLevel),
                  "p-6 focus:outline-none",
                  size === "sm" && "max-w-[400px]",
                  size === "lg" && "max-w-[540px]",
                  shape.container,
                  className,
                )}
                style={{
                  ...toMotionStyle(baseStyle),
                  ...toMotionStyle(props.style),
                }}
                initial={{ opacity: 0, scale: 0.97, x: "-50%", y: "-50%" }}
                animate={{
                  opacity: exiting ? 0 : 1,
                  scale: exiting ? 0.97 : 1,
                  x: "-50%",
                  y: "-50%",
                }}
                transition={exiting ? spring.slow.exit : spring.slow}
              >
                <SurfaceProvider value={dialogLevel}>
                  {children}
                  <DialogPrimitive.Close
                    render={
                      <Button variant="ghost" size="icon-sm" className="absolute right-3 top-3">
                        <XIcon />
                        <span className="sr-only">Close</span>
                      </Button>
                    }
                  />
                </SurfaceProvider>
              </motion.div>
            );
          }}
        />
      </DialogPrimitive.Portal>
    );
  },
);
DialogContent.displayName = "DialogContent";

function DialogHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-1.5 mb-4", className)} {...props} />;
}

function DialogFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex justify-end gap-2 mt-6", className)} {...props} />;
}

const DialogTitle = forwardRef<HTMLHeadingElement, HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <DialogPrimitive.Title
      ref={ref}
      className={cn("text-[16px] text-foreground leading-tight", className)}
      style={{ fontVariationSettings: "'wght' 700" }}
      {...props}
    />
  ),
);
DialogTitle.displayName = "DialogTitle";

const DialogDescription = forwardRef<HTMLParagraphElement, HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <DialogPrimitive.Description
      ref={ref}
      className={cn("text-[13px] text-muted-foreground", className)}
      {...props}
    />
  ),
);
DialogDescription.displayName = "DialogDescription";

export {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
  DialogClose,
};
