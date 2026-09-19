"use client";
// Vendored from Fluid Functionalism (github.com/mickadesign/fluid-functionalism), MIT.

import type { HTMLAttributes, ReactNode, RefAttributes } from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { motion } from "framer-motion";
import { XIcon } from "lucide-react";

import { Button } from "@repo/ui/components/button";
import { motionProps, motionStyle } from "@repo/ui/lib/motion-style";
import type { MotionConflictHandler } from "@repo/ui/lib/motion-style";
import { useRadius } from "@repo/ui/lib/radius-context";
import { useSize } from "@repo/ui/lib/size-context";
import { spring } from "@repo/ui/lib/springs";
import { surfaceClasses } from "@repo/ui/lib/surface-classes";
import { SurfaceProvider, useSurface } from "@repo/ui/lib/surface-context";
import { cn } from "@repo/ui/lib/cn";

const DIALOG_OFFSET = 4;

interface DialogProps {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  modal?: boolean;
  children?: ReactNode;
}

const Dialog = ({ children, open, defaultOpen, onOpenChange, modal }: DialogProps) => (
  <DialogPrimitive.Root
    open={open}
    defaultOpen={defaultOpen}
    onOpenChange={(next) => onOpenChange?.(next)}
    modal={modal}
  >
    {children}
  </DialogPrimitive.Root>
);

interface DialogContentProps extends Omit<HTMLAttributes<HTMLDivElement>, MotionConflictHandler> {
  showCloseButton?: boolean;
  initialFocus?: DialogPrimitive.Popup.Props["initialFocus"];
}

const DialogContent = ({
  className,
  children,
  showCloseButton = true,
  initialFocus,
  style,
  ref,
  ...props
}: DialogContentProps & RefAttributes<HTMLDivElement>) => {
  const radius = useRadius();
  const substrate = useSurface();
  const dialogLevel = Math.min(substrate + DIALOG_OFFSET, 8);
  const compact = useSize().variant === "compact";

  // no `if (!open) return null`: Base UI's Popup unmounts itself after the motion tween finishes
  // (via getAnimations()), and an early return would cut the closing animation.
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Backdrop
        render={(backdropProps, state) => {
          const exiting = state.transitionStatus === "ending";
          const { style: _style, ...rest } = motionProps(backdropProps);
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
        initialFocus={initialFocus}
        render={(popupProps, state) => {
          const exiting = state.transitionStatus === "ending";
          const { style: baseStyle, ...rest } = motionProps(popupProps);
          // centering rides CSS translate utilities, not motion x/y, so a consumer className can
          // override one axis (the command palette pins `top-1/3 translate-y-0`).
          // CommandItem restyles itself through `in-data-[slot=dialog-content]`.
          return (
            <motion.div
              {...rest}
              {...props}
              data-slot="dialog-content"
              className={cn(
                "fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2",
                surfaceClasses(dialogLevel),
                "p-6 focus:outline-none",
                compact ? "max-w-[360px]" : "max-w-[400px]",
                radius.container,
                className,
              )}
              style={motionStyle(baseStyle, style)}
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: exiting ? 0 : 1, scale: exiting ? 0.97 : 1 }}
              transition={exiting ? spring.slow.exit : spring.slow}
            >
              <SurfaceProvider value={dialogLevel}>
                {children}
                {showCloseButton && (
                  <DialogPrimitive.Close
                    render={
                      <Button
                        variant="ghost"
                        size="icon-compact"
                        className="absolute top-3 right-3"
                      >
                        <XIcon />
                        <span className="sr-only">Close</span>
                      </Button>
                    }
                  />
                )}
              </SurfaceProvider>
            </motion.div>
          );
        }}
      />
    </DialogPrimitive.Portal>
  );
};
DialogContent.displayName = "DialogContent";

const DialogHeader = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("mb-4 flex flex-col gap-1.5", className)} {...props} />
);

const DialogTitle = ({
  className,
  ref,
  ...props
}: HTMLAttributes<HTMLHeadingElement> & RefAttributes<HTMLHeadingElement>) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn("text-title leading-tight text-foreground", className)}
    style={{ fontVariationSettings: "'wght' 700" }}
    {...props}
  />
);
DialogTitle.displayName = "DialogTitle";

const DialogDescription = ({
  className,
  ref,
  ...props
}: HTMLAttributes<HTMLParagraphElement> & RefAttributes<HTMLParagraphElement>) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-body text-muted-foreground", className)}
    {...props}
  />
);
DialogDescription.displayName = "DialogDescription";

export { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription };
