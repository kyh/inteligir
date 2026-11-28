"use client";
// @license MIT, vendored from Fluid Functionalism (github.com/mickadesign/fluid-functionalism).

import type { HTMLAttributes, ReactNode, RefAttributes } from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import type { HTMLProps } from "@base-ui/react/types";
import { motion } from "motion/react";
import { XClose as XIcon } from "@untitledui/icons";

import { Button } from "@repo/ui/components/button";
import { Elevated } from "@repo/ui/lib/elevated";
import { motionProps, motionStyle } from "@repo/ui/lib/motion-style";
import { PopupOpen, PopupPresence } from "@repo/ui/lib/popup-presence";
import type { MotionConflictHandler } from "@repo/ui/lib/motion-style";
import { radius } from "@repo/ui/lib/radius";
import { spring } from "@repo/ui/lib/springs";
import { cn } from "@repo/ui/lib/cn";

const DIALOG_OFFSET = 4;

const BACKDROP_CLASSES =
  "fixed inset-0 min-h-dvh bg-black/40 supports-[-webkit-touch-callout:none]:absolute dark:bg-black/80";

const renderDialogBackdrop = (backdropProps: HTMLProps<HTMLDivElement>) => {
  const { style: _style, ...rest } = motionProps(backdropProps);

  return (
    <motion.div
      {...rest}
      className={cn(BACKDROP_CLASSES, "z-50")}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: spring.slow }}
      exit={{ opacity: 0, transition: spring.slow.exit }}
    />
  );
};

interface DialogCardProps extends Omit<HTMLAttributes<HTMLDivElement>, MotionConflictHandler> {
  popupProps: HTMLProps<HTMLDivElement>;
}

const DialogCard = ({ popupProps, className, style, ...props }: DialogCardProps) => {
  const { style: baseStyle, ...rest } = motionProps(popupProps);

  return (
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
      animate={{ opacity: 1, scale: 1, transition: spring.slow }}
      exit={{ opacity: 0, scale: 0.97, transition: spring.slow.exit }}
    />
  );
};

interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  modal?: boolean;
  children?: ReactNode;
}

const Dialog = ({ children, open, onOpenChange, modal }: DialogProps) => (
  <DialogPrimitive.Root
    open={open}
    onOpenChange={(next) => {
      onOpenChange(next);
    }}
    modal={modal}
  >
    <PopupOpen open={open}>{children}</PopupOpen>
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
}: DialogContentProps & RefAttributes<HTMLDivElement>) => (
  <PopupPresence>
    <DialogPrimitive.Portal keepMounted>
      <DialogPrimitive.Backdrop render={renderDialogBackdrop} />
      <DialogPrimitive.Popup
        ref={ref}
        initialFocus={initialFocus}
        render={(popupProps) => (
          <DialogCard
            {...props}
            popupProps={popupProps}
            data-slot="dialog-content"
            className={cn("w-[calc(100%-2rem)] max-w-[360px]", className)}
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
  </PopupPresence>
);

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

export {
  BACKDROP_CLASSES,
  Dialog,
  DialogCard,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  renderDialogBackdrop,
};
