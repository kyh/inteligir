"use client";
// Vendored from shadcn/ui (github.com/shadcn-ui/ui), MIT.

import * as React from "react";
import { AlertDialog as AlertDialogPrimitive } from "@base-ui/react/alert-dialog";

import { DialogCard, renderDialogBackdrop } from "@repo/ui/components/dialog";
import { cn } from "@repo/ui/lib/cn";
import { PopupOpen, PopupPresence } from "@repo/ui/lib/popup-presence";

// controlled, as Dialog is: the Portal's presence reads the open it is handed
interface AlertDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children?: React.ReactNode;
}

const AlertDialog = ({ open, onOpenChange, children }: AlertDialogProps) => (
  <AlertDialogPrimitive.Root
    open={open}
    onOpenChange={(next) => {
      onOpenChange(next);
    }}
  >
    <PopupOpen open={open}>{children}</PopupOpen>
  </AlertDialogPrimitive.Root>
);

interface AlertDialogContentProps extends Omit<
  AlertDialogPrimitive.Popup.Props,
  "className" | "render" | "style"
> {
  className?: string;
  size?: "default" | "sm";
}

// Dialog's backdrop and card over the alert primitive's own parts, which keep the alertdialog role
// and refuse an outside-press dismissal
const AlertDialogContent = ({ className, size = "default", ...props }: AlertDialogContentProps) => (
  <PopupPresence>
    <AlertDialogPrimitive.Portal keepMounted>
      <AlertDialogPrimitive.Backdrop render={renderDialogBackdrop} />
      <AlertDialogPrimitive.Popup
        {...props}
        render={(popupProps) => (
          <DialogCard
            popupProps={popupProps}
            data-slot="alert-dialog-content"
            data-size={size}
            className={cn(
              "group/alert-dialog-content grid w-full gap-6 data-[size=default]:max-w-xs data-[size=sm]:max-w-xs data-[size=default]:sm:max-w-md",
              className,
            )}
          />
        )}
      />
    </AlertDialogPrimitive.Portal>
  </PopupPresence>
);

const AlertDialogHeader = ({ className, ...props }: React.ComponentProps<"div">) => (
  <div
    data-slot="alert-dialog-header"
    className={cn(
      "grid grid-rows-[auto_1fr] place-items-center gap-1.5 text-center sm:group-data-[size=default]/alert-dialog-content:place-items-start sm:group-data-[size=default]/alert-dialog-content:text-left",
      className,
    )}
    {...props}
  />
);

const AlertDialogFooter = ({ className, ...props }: React.ComponentProps<"div">) => (
  <div
    data-slot="alert-dialog-footer"
    className={cn(
      "flex flex-col-reverse gap-2 group-data-[size=sm]/alert-dialog-content:grid group-data-[size=sm]/alert-dialog-content:grid-cols-2 sm:flex-row sm:justify-end",
      className,
    )}
    {...props}
  />
);

const AlertDialogTitle = ({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Title>) => (
  <AlertDialogPrimitive.Title
    data-slot="alert-dialog-title"
    className={cn("font-heading text-title font-medium", className)}
    {...props}
  />
);

const AlertDialogDescription = ({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Description>) => (
  <AlertDialogPrimitive.Description
    data-slot="alert-dialog-description"
    className={cn(
      "text-subtitle text-balance text-muted-foreground md:text-pretty *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
      className,
    )}
    {...props}
  />
);

export {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
};
