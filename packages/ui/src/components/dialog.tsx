"use client";
// Vendored from Fluid Functionalism (github.com/mickadesign/fluid-functionalism), MIT.

import type { HTMLAttributes, ReactNode, RefAttributes } from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import type { HTMLProps } from "@base-ui/react/types";
import { motion } from "framer-motion";
import { XIcon } from "lucide-react";

import { Button } from "@repo/ui/components/button";
import { Elevated } from "@repo/ui/lib/elevated";
import { motionProps, motionStyle } from "@repo/ui/lib/motion-style";
import { PopupExit } from "@repo/ui/lib/popup-exit";
import type { MotionConflictHandler } from "@repo/ui/lib/motion-style";
import { useRadius } from "@repo/ui/lib/radius-context";
import { useSize } from "@repo/ui/lib/size-context";
import { spring } from "@repo/ui/lib/springs";
import { cn } from "@repo/ui/lib/cn";

const DIALOG_OFFSET = 4;

// The modal skin, Dialog's and AlertDialog's alike: the two primitives share their Backdrop and
// Popup, so a second skin would only be a second look for one kind of surface.
const renderDialogBackdrop = (
  backdropProps: HTMLProps<HTMLDivElement>,
  state: DialogPrimitive.Backdrop.State,
) => {
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
};

interface DialogCardProps extends Omit<HTMLAttributes<HTMLDivElement>, MotionConflictHandler> {
  // what the primitive's render prop hands over; the card spreads it so the Popup element itself
  // is the one that animates, which is what Base UI waits on before it unmounts
  popupProps: HTMLProps<HTMLDivElement>;
  exiting: boolean;
}

const DialogCard = ({ popupProps, exiting, className, style, ...props }: DialogCardProps) => {
  const radius = useRadius();
  const { style: baseStyle, ...rest } = motionProps(popupProps);
  // centering rides CSS translate utilities, not motion x/y, so a consumer className can
  // override one axis (the command palette pins `top-1/3 translate-y-0`)
  return (
    <PopupExit exiting={exiting}>
      <Elevated
        {...rest}
        {...props}
        offset={DIALOG_OFFSET}
        className={cn(
          "fixed top-1/2 left-1/2 z-50 -translate-x-1/2 -translate-y-1/2 p-6 focus:outline-none",
          radius.container,
          className,
        )}
        style={motionStyle(baseStyle, style)}
        initial={{ opacity: 0, scale: 0.97 }}
        animate={{ opacity: exiting ? 0 : 1, scale: exiting ? 0.97 : 1 }}
        transition={exiting ? spring.slow.exit : spring.slow}
      />
    </PopupExit>
  );
};

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
  const compact = useSize().variant === "compact";

  // no `if (!open) return null`: Base UI's Popup unmounts itself after the motion tween finishes
  // (via getAnimations()), and an early return would cut the closing animation.
  // CommandItem restyles itself through `in-data-[slot=dialog-content]`.
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Backdrop render={renderDialogBackdrop} />
      <DialogPrimitive.Popup
        ref={ref}
        initialFocus={initialFocus}
        render={(popupProps, state) => (
          <DialogCard
            {...props}
            popupProps={popupProps}
            exiting={state.transitionStatus === "ending"}
            data-slot="dialog-content"
            className={cn(
              "w-[calc(100%-2rem)]",
              compact ? "max-w-[360px]" : "max-w-[400px]",
              className,
            )}
            style={style}
          >
            {children}
            {showCloseButton && (
              <DialogPrimitive.Close
                render={
                  <Button variant="ghost" size="icon-compact" className="absolute top-3 right-3">
                    <XIcon />
                    <span className="sr-only">Close</span>
                  </Button>
                }
              />
            )}
          </DialogCard>
        )}
      />
    </DialogPrimitive.Portal>
  );
};
DialogContent.displayName = "DialogContent";

interface DialogPopupProps extends Omit<HTMLAttributes<HTMLDivElement>, MotionConflictHandler> {
  // the element the popup mounts in, so a dialog serving one region floats inside it
  container?: DialogPrimitive.Portal.Props["container"];
  initialFocus?: DialogPrimitive.Popup.Props["initialFocus"];
  finalFocus?: DialogPrimitive.Popup.Props["finalFocus"];
}

// The popup alone, for a dialog whose content is its own surface and whose consumer places it:
// no card, no backdrop, no close button. Pair it with a non-modal `Dialog`, which leaves the page
// around it live.
const DialogPopup = ({
  className,
  children,
  container,
  initialFocus,
  finalFocus,
  style,
  ref,
  ...props
}: DialogPopupProps & RefAttributes<HTMLDivElement>) => (
  <DialogPrimitive.Portal container={container}>
    <DialogPrimitive.Popup
      ref={ref}
      initialFocus={initialFocus}
      finalFocus={finalFocus}
      render={(popupProps, state) => {
        const exiting = state.transitionStatus === "ending";
        const { style: baseStyle, ...rest } = motionProps(popupProps);
        return (
          <PopupExit exiting={exiting}>
            <motion.div
              {...rest}
              {...props}
              data-slot="dialog-popup"
              className={cn("z-50 focus:outline-none", className)}
              style={motionStyle(baseStyle, style)}
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: exiting ? 0 : 1, scale: exiting ? 0.97 : 1 }}
              transition={exiting ? spring.slow.exit : spring.slow}
            >
              {children}
            </motion.div>
          </PopupExit>
        );
      }}
    />
  </DialogPrimitive.Portal>
);
DialogPopup.displayName = "DialogPopup";

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

export {
  Dialog,
  DialogCard,
  DialogContent,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  renderDialogBackdrop,
};
