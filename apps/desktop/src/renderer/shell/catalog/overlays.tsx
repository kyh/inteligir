// Overlay components for the widget catalog. Each renders its content in a
// portal and takes a `trigger` label that styles the built-in trigger button
// (via buttonVariants on the native button — not the `render` prop, which the
// wrapper types don't surface); the children are the overlay body. Built-in
// affordances (✕ / Escape / outside-click / hover-out) handle closing —
// overlays are uncontrolled, so an action inside them does not auto-close.

import { buttonVariants } from "@repo/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@repo/ui/components/dialog";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@repo/ui/components/drawer";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@repo/ui/components/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@repo/ui/components/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@repo/ui/components/tooltip";

import type { BaseProps } from "@/renderer/shell/catalog/shared";

const overlayTriggerClass = buttonVariants({ variant: "outline", size: "sm" });

export function CatalogDialog({
  props,
  children,
}: BaseProps<{ trigger: string; title?: string; description?: string }>) {
  return (
    <Dialog>
      <DialogTrigger className={overlayTriggerClass}>{props.trigger}</DialogTrigger>
      <DialogContent>
        {props.title || props.description ? (
          <DialogHeader>
            {props.title ? <DialogTitle>{props.title}</DialogTitle> : null}
            {props.description ? <DialogDescription>{props.description}</DialogDescription> : null}
          </DialogHeader>
        ) : null}
        {children}
      </DialogContent>
    </Dialog>
  );
}

export function CatalogDrawer({
  props,
  children,
}: BaseProps<{
  trigger: string;
  title?: string;
  description?: string;
  side?: "top" | "bottom" | "left" | "right";
}>) {
  return (
    <Drawer direction={props.side ?? "right"}>
      <DrawerTrigger className={overlayTriggerClass}>{props.trigger}</DrawerTrigger>
      <DrawerContent>
        {props.title || props.description ? (
          <DrawerHeader>
            {props.title ? <DrawerTitle>{props.title}</DrawerTitle> : null}
            {props.description ? <DrawerDescription>{props.description}</DrawerDescription> : null}
          </DrawerHeader>
        ) : null}
        <div className="flex flex-col gap-2 p-4 pt-0">{children}</div>
      </DrawerContent>
    </Drawer>
  );
}

export function CatalogPopover({ props, children }: BaseProps<{ trigger: string }>) {
  return (
    <Popover>
      <PopoverTrigger className={overlayTriggerClass}>{props.trigger}</PopoverTrigger>
      <PopoverContent>{children}</PopoverContent>
    </Popover>
  );
}

export function CatalogTooltip({ props, children }: BaseProps<{ text: string }>) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger className="inline-flex w-fit cursor-help">{children}</TooltipTrigger>
        <TooltipContent>{props.text}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function CatalogDropdownMenu({ props, children }: BaseProps<{ trigger: string }>) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={overlayTriggerClass}>{props.trigger}</DropdownMenuTrigger>
      <DropdownMenuContent>{children}</DropdownMenuContent>
    </DropdownMenu>
  );
}

export function CatalogMenuItem({
  props,
  emit,
}: BaseProps<{ label: string; variant?: "default" | "destructive"; disabled?: boolean }>) {
  return (
    <DropdownMenuItem
      variant={props.variant ?? "default"}
      disabled={props.disabled === true}
      onClick={() => emit("press")}
    >
      {props.label}
    </DropdownMenuItem>
  );
}
