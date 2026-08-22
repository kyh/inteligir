"use client";
// Vendored from Fluid Functionalism (github.com/mickadesign/fluid-functionalism), MIT.

import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { motion } from "framer-motion";

import { Button } from "@repo/ui/components/button";
import { useIcon } from "@repo/ui/lib/icon-context";
import { motionStyle } from "@repo/ui/lib/motion-style";
import { useShape } from "@repo/ui/lib/shape-context";
import { useSize, useSizeVariant } from "@repo/ui/lib/size-context";
import { spring } from "@repo/ui/lib/springs";
import { surfaceClasses } from "@repo/ui/lib/surface-classes";
import { SurfaceProvider, useSurface } from "@repo/ui/lib/surface-context";
import { cn } from "@repo/ui/lib/utils";

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

// framer's motion.div redefines the DOM drag/animation handlers, so they are
// omitted from the public props rather than cast away at the spread.
type MotionConflictHandler =
  | "onDrag"
  | "onDragStart"
  | "onDragEnd"
  | "onAnimationStart"
  | "onAnimationEnd"
  | "onAnimationIteration";

interface DialogContentProps extends Omit<HTMLAttributes<HTMLDivElement>, MotionConflictHandler> {
  size?: "sm" | "lg";
  /** Portal target. When set, the overlay and panel render inside this element
   *  (positioned `absolute`) instead of covering the viewport (`fixed`). Pair
   *  with a `position: relative; overflow: hidden` container — and usually
   *  `<Dialog modal={false}>` — to scope a dialog to a bounded region, e.g. a
   *  docs preview. Defaults to the document body / full-viewport behaviour. */
  container?: HTMLElement | null;
  showCloseButton?: boolean;
  /** Forwarded to Base UI's Popup: the element focused when the dialog opens. */
  initialFocus?: DialogPrimitive.Popup.Props["initialFocus"];
}

const DialogContent = forwardRef<HTMLDivElement, DialogContentProps>(
  (
    {
      className,
      children,
      size = "sm",
      container,
      showCloseButton = true,
      initialFocus,
      style,
      ...props
    },
    ref,
  ) => {
    const XIcon = useIcon("x");
    const shape = useShape();
    const substrate = useSurface();
    const dialogLevel = Math.min(substrate + DIALOG_OFFSET, 8);
    // The size ladder narrows the dialog one notch in compact regions —
    // width only, the padding stays put (see /docs/sizes).
    const compact = useSize().variant === "compact";

    // No `if (!open) return null` here — Base UI's `<DialogPrimitive.Popup>`
    // handles mount/unmount itself, and waits for the framer-motion opacity
    // tween below to finish (via `element.getAnimations()`) before unmounting.
    // Returning null early would short-circuit the closing animation.
    return (
      <DialogPrimitive.Portal container={container ?? undefined}>
        <DialogPrimitive.Backdrop
          render={(backdropProps, state) => {
            const exiting = state.transitionStatus === "ending";
            // framer's motion.div redefines the drag/animation handlers, so
            // Base UI's DOM-typed ones are dropped before the spread.
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
                className={cn(
                  container ? "absolute" : "fixed",
                  "inset-0 z-50 bg-black/40 dark:bg-black/80",
                )}
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
            // Deviation from upstream fluid, which centers via motion
            // x/y "-50%": centering rides the CSS translate utilities instead,
            // so a consumer className can override one axis (the command
            // palette pins `top-1/3 translate-y-0`). The CSS `translate`
            // property composes before `transform`, so rendering is identical;
            // motion animates opacity/scale only.
            //
            // `data-slot="dialog-content"` stays on the popup: CommandItem
            // restyles itself inside a dialog through an
            // `in-data-[slot=dialog-content]` variant.
            return (
              <motion.div
                {...rest}
                {...props}
                data-slot="dialog-content"
                className={cn(
                  container ? "absolute" : "fixed",
                  "top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2",
                  surfaceClasses(dialogLevel),
                  "p-6 focus:outline-none",
                  size === "sm" && (compact ? "max-w-[360px]" : "max-w-[400px]"),
                  size === "lg" && (compact ? "max-w-[480px]" : "max-w-[540px]"),
                  shape.container,
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
                        <Button variant="ghost" size="icon-sm" className="absolute top-3 right-3">
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
  },
);
DialogContent.displayName = "DialogContent";

function DialogHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("mb-4 flex flex-col gap-1.5", className)} {...props} />;
}

function DialogFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("mt-6 flex justify-end gap-2", className)} {...props} />;
}

const DialogTitle = forwardRef<HTMLHeadingElement, HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => {
    // The title role of the type scale — see /docs/sizes.
    const compact = useSizeVariant() === "compact";
    return (
      <DialogPrimitive.Title
        ref={ref}
        className={cn(
          compact ? "text-[15px]" : "text-[16px]",
          "text-foreground leading-tight",
          className,
        )}
        style={{ fontVariationSettings: "'wght' 700" }}
        {...props}
      />
    );
  },
);
DialogTitle.displayName = "DialogTitle";

const DialogDescription = forwardRef<HTMLParagraphElement, HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => {
    const compact = useSizeVariant() === "compact";
    return (
      <DialogPrimitive.Description
        ref={ref}
        className={cn(compact ? "text-[12px]" : "text-[13px]", "text-muted-foreground", className)}
        {...props}
      />
    );
  },
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
