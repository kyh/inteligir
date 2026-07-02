"use client";

import { type ComponentProps } from "react";
import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import { ChevronRightIcon } from "lucide-react";

import { cn } from "@repo/ui/lib/utils";

const itemClass =
  "relative flex w-full cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none select-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground data-[highlighted]:[&_svg]:text-accent-foreground";

const popupClass =
  "z-50 max-h-[var(--available-height)] min-w-[180px] origin-[var(--transform-origin)] overflow-y-auto rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-surface-4 outline-none transition-[transform,opacity] data-[ending-style]:opacity-0 data-[starting-style]:opacity-0";

function Menu(props: ComponentProps<typeof MenuPrimitive.Root>) {
  return <MenuPrimitive.Root {...props} />;
}

const MenuTrigger = MenuPrimitive.Trigger;
const MenuGroup = MenuPrimitive.Group;

function MenuContent({
  className,
  side = "bottom",
  align = "start",
  sideOffset = 4,
  anchor,
  ...props
}: ComponentProps<typeof MenuPrimitive.Popup> & {
  side?: ComponentProps<typeof MenuPrimitive.Positioner>["side"];
  align?: ComponentProps<typeof MenuPrimitive.Positioner>["align"];
  sideOffset?: number;
  anchor?: ComponentProps<typeof MenuPrimitive.Positioner>["anchor"];
}) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Positioner
        side={side}
        align={align}
        sideOffset={sideOffset}
        anchor={anchor}
        className="z-50"
      >
        <MenuPrimitive.Popup className={cn(popupClass, className)} {...props} />
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  );
}

function MenuItem({ className, ...props }: ComponentProps<typeof MenuPrimitive.Item>) {
  return <MenuPrimitive.Item className={cn(itemClass, className)} {...props} />;
}

function MenuSeparator({ className, ...props }: ComponentProps<typeof MenuPrimitive.Separator>) {
  return (
    <MenuPrimitive.Separator className={cn("-mx-1 my-1 h-px bg-border", className)} {...props} />
  );
}

function MenuGroupLabel({ className, ...props }: ComponentProps<typeof MenuPrimitive.GroupLabel>) {
  return (
    <MenuPrimitive.GroupLabel
      className={cn("px-2 py-1 text-xs font-medium text-muted-foreground", className)}
      {...props}
    />
  );
}

const MenuSub = MenuPrimitive.SubmenuRoot;

function MenuSubTrigger({
  className,
  children,
  ...props
}: ComponentProps<typeof MenuPrimitive.SubmenuTrigger>) {
  return (
    <MenuPrimitive.SubmenuTrigger
      className={cn(itemClass, "data-[popup-open]:bg-accent", className)}
      {...props}
    >
      {children}
      <ChevronRightIcon className="ml-auto" />
    </MenuPrimitive.SubmenuTrigger>
  );
}

function MenuSubContent({
  className,
  sideOffset = 0,
  ...props
}: ComponentProps<typeof MenuPrimitive.Popup> & { sideOffset?: number }) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Positioner side="inline-end" align="start" sideOffset={sideOffset}>
        <MenuPrimitive.Popup className={cn(popupClass, className)} {...props} />
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  );
}

export {
  Menu,
  MenuTrigger,
  MenuContent,
  MenuItem,
  MenuGroup,
  MenuGroupLabel,
  MenuSeparator,
  MenuSub,
  MenuSubTrigger,
  MenuSubContent,
};
