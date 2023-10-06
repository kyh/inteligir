"use client";

import * as Popover from "@radix-ui/react-popover";
import * as Portal from "@radix-ui/react-portal";
import * as React from "react";
import { cn } from "../lib/cn";
import { Kbd } from "./kbd";

type CommandBarProps = React.PropsWithChildren<{
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  defaultOpen?: boolean;
  disableAutoFocus?: boolean;
}>;

const Root = ({
  open = false,
  onOpenChange,
  defaultOpen = false,
  disableAutoFocus = true,
  children,
}: CommandBarProps) => {
  return (
    <Popover.Root
      defaultOpen={defaultOpen}
      onOpenChange={onOpenChange}
      open={open}
    >
      <Portal.Root>
        <Popover.Anchor
          className={cn("fixed bottom-8 left-1/2 h-px w-px -translate-x-1/2")}
        />
      </Portal.Root>
      <Popover.Portal>
        <Popover.Content
          className={cn(
            "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
          )}
          onOpenAutoFocus={(e) => {
            if (disableAutoFocus) {
              e.preventDefault();
            }
          }}
          side="top"
          sideOffset={0}
        >
          {children}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
};
Root.displayName = "CommandBar";

const Value = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<"div">
>(({ className, ...props }, ref) => {
  return (
    <div
      className={cn(
        "px-3 py-2.5 text-xs text-ui-contrast-fg-secondary",
        className,
      )}
      ref={ref}
      {...props}
    />
  );
});
Value.displayName = "CommandBar.Value";

const Bar = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<"div">
>(({ className, ...props }, ref) => {
  return (
    <div
      className={cn(
        "relative flex items-center overflow-hidden rounded-full bg-ui-contrast-bg-base px-1",
        "after:pointer-events-none after:absolute after:inset-0 after:rounded-full after:shadow-elevation-flyout after:content-['']",
        className,
      )}
      ref={ref}
      {...props}
    />
  );
});
Bar.displayName = "CommandBar.Bar";

const Seperator = React.forwardRef<
  HTMLDivElement,
  Omit<React.ComponentPropsWithoutRef<"div">, "children">
>(({ className, ...props }, ref) => {
  return (
    <div
      className={cn("h-10 w-px bg-ui-contrast-border-base", className)}
      ref={ref}
      {...props}
    />
  );
});
Seperator.displayName = "CommandBar.Seperator";

type CommandProps = {
  action: () => void | Promise<void>;
  label: string;
  shortcut: string;
} & Omit<React.ComponentPropsWithoutRef<"button">, "children" | "onClick">;

const Command = React.forwardRef<HTMLButtonElement, CommandProps>(
  (
    { className, type = "button", label, action, shortcut, disabled, ...props },
    ref,
  ) => {
    React.useEffect(() => {
      const handleKeyDown = (event: KeyboardEvent) => {
        if (event.key === shortcut) {
          event.preventDefault();
          event.stopPropagation();
          void action();
        }
      };

      if (!disabled) {
        document.addEventListener("keydown", handleKeyDown);
      }

      return () => {
        document.removeEventListener("keydown", handleKeyDown);
      };
    }, [action, shortcut, disabled]);

    return (
      <button
        className={cn(
          "flex items-center gap-x-2 bg-ui-contrast-bg-base px-3 py-2.5 text-xs text-ui-contrast-fg-primary outline-none transition-fg",
          "hover:bg-ui-contrast-bg-base-hover focus:bg-ui-contrast-bg-highlight focus:hover:bg-ui-contrast-bg-base-hover active:bg-ui-contrast-bg-base-pressed focus:active:bg-ui-contrast-bg-base-pressed disabled:!bg-ui-bg-disabled disabled:!text-ui-fg-disabled",
          "last-of-type:-mr-1 last-of-type:pr-4",
          className,
        )}
        onClick={action}
        ref={ref}
        type={type}
        {...props}
      >
        <span>{label}</span>
        <Kbd className="border-ui-contrast-border-base bg-ui-contrast-bg-subtle text-ui-contrast-fg-secondary">
          {shortcut.toUpperCase()}
        </Kbd>
      </button>
    );
  },
);
Command.displayName = "CommandBar.Command";

const CommandBar = Object.assign(Root, {
  Command,
  Value,
  Bar,
  Seperator,
});

export { CommandBar };
