"use client";

import { XIcon } from "../icons";
import * as DrawerPrimitives from "@radix-ui/react-dialog";
import * as React from "react";
import { IconButton } from "./icon-button";
import { Kbd } from "./kbd";
import { cn } from "../lib/cn";

const DrawerRoot = (
  props: React.ComponentPropsWithoutRef<typeof DrawerPrimitives.Root>,
) => {
  return <DrawerPrimitives.Root {...props} />;
};
DrawerRoot.displayName = "Drawer.Root";

const DrawerTrigger = React.forwardRef<
  React.ElementRef<typeof DrawerPrimitives.Trigger>,
  React.ComponentPropsWithoutRef<typeof DrawerPrimitives.Trigger>
>(({ className, ...props }, ref) => {
  return (
    <DrawerPrimitives.Trigger ref={ref} className={cn(className)} {...props} />
  );
});
DrawerTrigger.displayName = "Drawer.Trigger";

const DrawerClose = React.forwardRef<
  React.ElementRef<typeof DrawerPrimitives.Close>,
  React.ComponentPropsWithoutRef<typeof DrawerPrimitives.Close>
>(({ className, ...props }, ref) => {
  return (
    <DrawerPrimitives.Close ref={ref} className={cn(className)} {...props} />
  );
});
DrawerClose.displayName = "Drawer.Close";

const DrawerPortal = (props: DrawerPrimitives.DialogPortalProps) => {
  return <DrawerPrimitives.DialogPortal {...props} />;
};
DrawerPortal.displayName = "Drawer.Portal";

const DrawerOverlay = React.forwardRef<
  React.ElementRef<typeof DrawerPrimitives.Overlay>,
  React.ComponentPropsWithoutRef<typeof DrawerPrimitives.Overlay>
>(({ className, ...props }, ref) => {
  return (
    <DrawerPrimitives.Overlay
      ref={ref}
      className={cn("fixed inset-0 bg-ui-bg-overlay", className)}
      {...props}
    />
  );
});
DrawerOverlay.displayName = "Drawer.Overlay";

const DrawerContent = React.forwardRef<
  React.ElementRef<typeof DrawerPrimitives.Content>,
  React.ComponentPropsWithoutRef<typeof DrawerPrimitives.Content>
>(({ className, ...props }, ref) => {
  return (
    <DrawerPortal>
      <DrawerOverlay />
      <DrawerPrimitives.Content
        ref={ref}
        className={cn(
          "fixed inset-y-2 right-2 flex w-full max-w-[560px] flex-1 flex-col rounded-lg border border-ui-border-base bg-ui-bg-base shadow-elevation-modal focus:outline-none",
          // "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:slide-out-to-right-1/2 data-[state=open]:slide-in-from-right-1/2 duration-200",
          className,
        )}
        {...props}
      />
    </DrawerPortal>
  );
});
DrawerContent.displayName = "Drawer.Content";

const DrawerHeader = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<"div">
>(({ children, className, ...props }, ref) => {
  return (
    <div
      ref={ref}
      className="flex items-start justify-between gap-x-4 border-b border-ui-border-base px-8 py-6"
      {...props}
    >
      <div className={cn("flex flex-col gap-y-1", className)}>{children}</div>
      <div className="flex items-center gap-x-2">
        <Kbd>esc</Kbd>
        <DrawerPrimitives.Close asChild>
          <IconButton variant="transparent">
            <XIcon className="w-5 h-5"/>
          </IconButton>
        </DrawerPrimitives.Close>
      </div>
    </div>
  );
});
DrawerHeader.displayName = "Drawer.Header";

const DrawerBody = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<"div">
>(({ className, ...props }, ref) => {
  return (
    <div
      ref={ref}
      className={cn("flex-1 px-8 pb-16 pt-6", className)}
      {...props}
    />
  );
});
DrawerBody.displayName = "Drawer.Body";

const DrawerFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => {
  return (
    <div
      className={cn(
        "flex items-center justify-end space-x-2 overflow-y-scroll border-t border-ui-border-base px-8 pb-6 pt-4",
        className,
      )}
      {...props}
    />
  );
};
DrawerFooter.displayName = "Drawer.Footer";

const DrawerTitle = React.forwardRef<
  React.ElementRef<typeof DrawerPrimitives.Title>,
  React.ComponentPropsWithoutRef<typeof DrawerPrimitives.Title>
>(({ className, children, ...props }, ref) => (
  <DrawerPrimitives.Title
    ref={ref}
    className={cn(className)}
    asChild
    {...props}
  >
    <h1 className="text-lg">{children}</h1>
  </DrawerPrimitives.Title>
));
DrawerTitle.displayName = "Drawer.Title";

const DrawerDescription = React.forwardRef<
  React.ElementRef<typeof DrawerPrimitives.Description>,
  React.ComponentPropsWithoutRef<typeof DrawerPrimitives.Description>
>(({ className, children, ...props }, ref) => (
  <DrawerPrimitives.Description
    ref={ref}
    className={cn(className)}
    asChild
    {...props}
  >
    {children}
  </DrawerPrimitives.Description>
));
DrawerDescription.displayName = "Drawer.Description";

const Drawer = Object.assign(DrawerRoot, {
  Body: DrawerBody,
  Close: DrawerClose,
  Content: DrawerContent,
  Description: DrawerDescription,
  Footer: DrawerFooter,
  Header: DrawerHeader,
  Title: DrawerTitle,
  Trigger: DrawerTrigger,
});

export { Drawer };
