"use client";
// Vendored from Fluid Functionalism (github.com/mickadesign/fluid-functionalism), MIT.

import type { HTMLAttributes, ReactNode, RefAttributes } from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import type { HTMLProps } from "@base-ui/react/types";
import { motion } from "motion/react";
import { XIcon } from "lucide-react";

import { Button } from "@repo/ui/components/button";
import { Elevated } from "@repo/ui/lib/elevated";
import { motionProps, motionStyle } from "@repo/ui/lib/motion-style";
import { PopupOpen, PopupPresence } from "@repo/ui/lib/popup-presence";
import type { MotionConflictHandler } from "@repo/ui/lib/motion-style";
import { radius } from "@repo/ui/lib/radius";
import { useSize } from "@repo/ui/lib/size-context";
import { spring } from "@repo/ui/lib/springs";
import { cn } from "@repo/ui/lib/cn";

const DIALOG_OFFSET = 4;

// The modal skin, Dialog's and AlertDialog's alike: the two primitives share their Backdrop and
// Popup, so a second skin would only be a second look for one kind of surface. Both fade under the
// Portal's presence (`@repo/ui/lib/popup-presence`), each with an exit of its own.
const renderDialogBackdrop = (backdropProps: HTMLProps<HTMLDivElement>) => {
  const { style: _style, ...rest } = motionProps(backdropProps);
  return (
    <motion.div
      {...rest}
      className="fixed inset-0 z-50 bg-black/40 dark:bg-black/80"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: spring.slow }}
      exit={{ opacity: 0, transition: spring.slow.exit }}
    />
  );
};

interface DialogCardProps extends Omit<HTMLAttributes<HTMLDivElement>, MotionConflictHandler> {
  // what the primitive's render prop hands over; the card spreads it so the Popup element itself
  // is the one that animates, which is what Base UI waits on before it unmounts
  popupProps: HTMLProps<HTMLDivElement>;
}

const DialogCard = ({ popupProps, className, style, ...props }: DialogCardProps) => {
  const { style: baseStyle, ...rest } = motionProps(popupProps);
  // centering rides CSS translate utilities, not motion x/y, so a consumer className can
  // override one axis
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

// controlled, as the Portal's presence reads the open it is handed
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
}: DialogContentProps & RefAttributes<HTMLDivElement>) => {
  const compact = useSize().variant === "compact";

  return (
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
    </PopupPresence>
  );
};

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
  Dialog,
  DialogCard,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  renderDialogBackdrop,
};
