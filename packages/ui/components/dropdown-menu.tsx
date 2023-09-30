"use client";

import { CheckIcon, ChevronRightIcon, MoreHorizontalIcon } from "../icons";
import * as Primitives from "@radix-ui/react-dropdown-menu";
import * as React from "react";

import { cn } from "../lib/cn";

const Root = Primitives.Root;
Root.displayName = "DropdownMenu.Root";

const Trigger = Primitives.Trigger;
Trigger.displayName = "DropdownMenu.Trigger";

const Group = Primitives.Group;
Group.displayName = "DropdownMenu.Group";

const SubMenu = Primitives.Sub;
SubMenu.displayName = "DropdownMenu.SubMenu";

const RadioGroup = Primitives.RadioGroup;
RadioGroup.displayName = "DropdownMenu.RadioGroup";

const SubMenuTrigger = React.forwardRef<
  React.ElementRef<typeof Primitives.SubTrigger>,
  React.ComponentPropsWithoutRef<typeof Primitives.SubTrigger>
>(({ className, children, ...props }, ref) => (
  <Primitives.SubTrigger
    ref={ref}
    className={cn(
      "flex cursor-default select-none items-center rounded-sm px-3 py-2 text-xs outline-none focus:bg-ui-bg-base-pressed data-[state=open]:bg-ui-bg-base-pressed",
      className,
    )}
    {...props}
  >
    {children}
    <ChevronRightIcon className="ml-auto" />
  </Primitives.SubTrigger>
));
SubMenuTrigger.displayName = "DropdownMenu.SubMenuTrigger";

const SubMenuContent = React.forwardRef<
  React.ElementRef<typeof Primitives.SubContent>,
  React.ComponentPropsWithoutRef<typeof Primitives.SubContent>
>(({ className, ...props }, ref) => (
  <Primitives.Portal>
    <Primitives.SubContent
      ref={ref}
      className={cn(
        "min-w-[8rem] overflow-hidden rounded-lg border bg-ui-bg-base p-1 text-ui-fg-base shadow-elevation-flyout",
        "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
        className,
      )}
      {...props}
    />
  </Primitives.Portal>
));
SubMenuContent.displayName = "DropdownMenu.SubMenuContent";

const Content = React.forwardRef<
  React.ElementRef<typeof Primitives.Content>,
  React.ComponentPropsWithoutRef<typeof Primitives.Content>
>(({ className, sideOffset = 8, align = "start", ...props }, ref) => (
  <Primitives.Portal>
    <Primitives.Content
      ref={ref}
      sideOffset={sideOffset}
      align={align}
      className={cn(
        "min-w-[300px] overflow-hidden rounded-lg bg-ui-bg-base p-1 text-ui-fg-base shadow-elevation-flyout",
        "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
        className,
      )}
      {...props}
    />
  </Primitives.Portal>
));
Content.displayName = "DropdownMenu.Content";

const Item = React.forwardRef<
  React.ElementRef<typeof Primitives.Item>,
  React.ComponentPropsWithoutRef<typeof Primitives.Item>
>(({ className, ...props }, ref) => (
  <Primitives.Item
    ref={ref}
    className={cn(
      "relative flex cursor-default select-none items-center rounded-md bg-ui-bg-base px-3 py-2 text-xs text-ui-fg-base outline-none transition-colors focus:bg-ui-bg-base-pressed data-[disabled]:pointer-events-none data-[disabled]:text-ui-fg-disabled",
      className,
    )}
    {...props}
  />
));
Item.displayName = "DropdownMenu.Item";

const CheckboxItem = React.forwardRef<
  React.ElementRef<typeof Primitives.CheckboxItem>,
  React.ComponentPropsWithoutRef<typeof Primitives.CheckboxItem>
>(({ className, children, checked, ...props }, ref) => (
  <Primitives.CheckboxItem
    ref={ref}
    className={cn(
      "relative flex cursor-default select-none items-center rounded-md py-2 pl-10 pr-3 text-sm text-ui-fg-base outline-none transition-colors focus:bg-ui-bg-base-pressed data-[disabled]:pointer-events-none data-[disabled]:text-ui-fg-disabled",
      className,
    )}
    checked={checked}
    {...props}
  >
    <span className="absolute left-3 flex h-5 w-5 items-center justify-center">
      <Primitives.ItemIndicator>
        <CheckIcon />
      </Primitives.ItemIndicator>
    </span>
    {children}
  </Primitives.CheckboxItem>
));
CheckboxItem.displayName = "DropdownMenu.CheckboxItem";

const RadioItem = React.forwardRef<
  React.ElementRef<typeof Primitives.RadioItem>,
  React.ComponentPropsWithoutRef<typeof Primitives.RadioItem>
>(({ className, children, ...props }, ref) => (
  <Primitives.RadioItem
    ref={ref}
    className={cn(
      "hover:bg-ui-base-hover relative flex cursor-default select-none items-center rounded-md bg-ui-bg-base py-2 pl-10 pr-3 text-sm text-xs outline-none transition-colors focus:bg-ui-bg-base-pressed data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
      className,
    )}
    {...props}
  >
    <span className="absolute left-3 flex h-5 w-5 items-center justify-center">
      <Primitives.ItemIndicator>
        <MoreHorizontalIcon className="text-ui-fg-base" />
      </Primitives.ItemIndicator>
    </span>
    {children}
  </Primitives.RadioItem>
));
RadioItem.displayName = "DropdownMenu.RadioItem";

const Label = React.forwardRef<
  React.ElementRef<typeof Primitives.Label>,
  React.ComponentPropsWithoutRef<typeof Primitives.Label>
>(({ className, ...props }, ref) => (
  <Primitives.Label
    ref={ref}
    className={cn("px-2 py-1.5 text-xs text-ui-fg-subtle", className)}
    {...props}
  />
));
Label.displayName = "DropdownMenu.Label";

const Separator = React.forwardRef<
  React.ElementRef<typeof Primitives.Separator>,
  React.ComponentPropsWithoutRef<typeof Primitives.Separator>
>(({ className, ...props }, ref) => (
  <Primitives.Separator
    ref={ref}
    className={cn("-mx-1 my-1 h-px bg-ui-border-base", className)}
    {...props}
  />
));
Separator.displayName = "DropdownMenu.Separator";

const Shortcut = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement>) => {
  return (
    <span
      className={cn(
        "ml-auto text-xs tracking-widest text-ui-fg-subtle",
        className,
      )}
      {...props}
    />
  );
};
Shortcut.displayName = "DropdownMenu.Shortcut";

const Hint = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement>) => {
  return (
    <span
      className={cn(
        "ml-auto text-xs tracking-widest text-ui-fg-subtle",
        className,
      )}
      {...props}
    />
  );
};
Hint.displayName = "DropdownMenu.Hint";

const DropdownMenu = Object.assign(Root, {
  Trigger,
  Group,
  SubMenu,
  SubMenuContent,
  SubMenuTrigger,
  Content,
  Item,
  CheckboxItem,
  RadioGroup,
  RadioItem,
  Label,
  Separator,
  Shortcut,
  Hint,
});

export { DropdownMenu };
