"use client";

import { XIcon } from "../icons";
import * as FocusModalPrimitives from "@radix-ui/react-dialog";
import * as React from "react";

import { IconButton } from "./icon-button";
import { Kbd } from "./kbd";
import { cn } from "../lib/cn";

const FocusModalRoot = (
  props: React.ComponentPropsWithoutRef<typeof FocusModalPrimitives.Root>,
) => {
  return <FocusModalPrimitives.Root {...props} />;
};
FocusModalRoot.displayName = "FocusModal";

const FocusModalTrigger = React.forwardRef<
  React.ElementRef<typeof FocusModalPrimitives.Trigger>,
  React.ComponentPropsWithoutRef<typeof FocusModalPrimitives.Trigger>
>((props, ref) => {
  return <FocusModalPrimitives.Trigger ref={ref} {...props} />;
});
FocusModalTrigger.displayName = "FocusModal.Trigger";

const FocusModalPortal = ({
  ...props
}: FocusModalPrimitives.DialogPortalProps) => {
  return <FocusModalPrimitives.DialogPortal {...props} />;
};
FocusModalPortal.displayName = "FocusModal.Portal";

const FocusModalOverlay = React.forwardRef<
  React.ElementRef<typeof FocusModalPrimitives.Overlay>,
  React.ComponentPropsWithoutRef<typeof FocusModalPrimitives.Overlay>
>(({ className, ...props }, ref) => {
  return (
    <FocusModalPrimitives.Overlay
      ref={ref}
      className={cn(
        "fixed inset-0 bg-ui-bg-overlay",
        // "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
        className,
      )}
      {...props}
    />
  );
});
FocusModalOverlay.displayName = "FocusModal.Overlay";

const FocusModalContent = React.forwardRef<
  React.ElementRef<typeof FocusModalPrimitives.Content>,
  React.ComponentPropsWithoutRef<typeof FocusModalPrimitives.Content>
>(({ className, ...props }, ref) => {
  return (
    <FocusModalPortal>
      <FocusModalOverlay />
      <FocusModalPrimitives.Content
        ref={ref}
        className={cn(
          "fixed inset-2 flex flex-col overflow-hidden rounded-lg border bg-ui-bg-base shadow-elevation-modal focus:outline-none",
          // "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 duration-200",
          className,
        )}
        {...props}
      />
    </FocusModalPortal>
  );
});
FocusModalContent.displayName = "FocusModal.Content";

const FocusModalHeader = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<"div">
>(({ children, className, ...props }, ref) => {
  return (
    <div
      ref={ref}
      className={cn(
        "flex items-center justify-between gap-x-4 border-b border-ui-border-base px-4 py-2",
        className,
      )}
      {...props}
    >
      <div className="flex items-center gap-x-2">
        <FocusModalPrimitives.Close asChild>
          <IconButton variant="transparent">
            <XIcon />
          </IconButton>
        </FocusModalPrimitives.Close>
        <Kbd>esc</Kbd>
      </div>
      {children}
    </div>
  );
});
FocusModalHeader.displayName = "FocusModal.Header";

const FocusModalBody = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<"div">
>(({ className, ...props }, ref) => {
  return <div ref={ref} className={cn("flex-1", className)} {...props} />;
});
FocusModalBody.displayName = "FocusModal.Body";

const FocusModal = Object.assign(FocusModalRoot, {
  Trigger: FocusModalTrigger,
  Content: FocusModalContent,
  Header: FocusModalHeader,
  Body: FocusModalBody,
});

export { FocusModal };
