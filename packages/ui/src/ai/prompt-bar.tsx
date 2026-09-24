"use client";
// Vendored from Beautiful UI (beautifului.dev), MIT.

import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  KeyboardEvent,
  ReactElement,
  ReactNode,
  RefAttributes,
  TextareaHTMLAttributes,
} from "react";
import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";
import { ArrowUpIcon, XIcon } from "lucide-react";

import { cn } from "@repo/ui/lib/cn";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@repo/ui/components/dropdown-menu";

const promptBarVariants = cva(
  "flex w-full flex-col bg-surface-raised shadow-surface-2 transition-[border-radius] duration-200",
  {
    defaultVariants: { radius: "rounded" },
    variants: {
      radius: {
        pill: "rounded-[22px]",
        rounded: "rounded-xl",
      },
    },
  },
);

export interface PromptBarProps
  extends HTMLAttributes<HTMLDivElement>, VariantProps<typeof promptBarVariants> {}

const PromptBar = ({
  className,
  radius,
  ref,
  ...props
}: PromptBarProps & RefAttributes<HTMLDivElement>) => (
  <div
    ref={ref}
    data-slot="prompt-bar"
    className={cn(promptBarVariants({ radius }), className)}
    {...props}
  />
);
PromptBar.displayName = "PromptBar";

const PromptBarSources = ({
  className,
  ref,
  ...props
}: HTMLAttributes<HTMLDivElement> & RefAttributes<HTMLDivElement>) => (
  <div
    ref={ref}
    data-slot="prompt-bar-sources"
    className={cn("flex flex-wrap items-center gap-1.5 px-3 pt-2.5", className)}
    {...props}
  />
);
PromptBarSources.displayName = "PromptBarSources";

export interface PromptBarSourceProps extends HTMLAttributes<HTMLSpanElement> {
  icon?: ReactNode;
  onRemove?: () => void;
}

const PromptBarSource = ({
  className,
  children,
  icon,
  onRemove,
  ref,
  ...props
}: PromptBarSourceProps & RefAttributes<HTMLSpanElement>) => (
  <span
    ref={ref}
    data-slot="prompt-bar-source"
    className={cn(
      "inline-flex h-6 items-center gap-1.5 rounded-full bg-surface-inset pr-1 pl-2",
      "text-[12px] font-medium text-ink-2 [&_svg]:size-3.5",
      className,
    )}
    {...props}
  >
    {icon}
    <span className="max-w-40 truncate">{children}</span>
    {onRemove === undefined ? null : (
      <button
        type="button"
        aria-label="Remove source"
        onClick={onRemove}
        className="flex size-4 items-center justify-center rounded-full text-ink-3 hover:bg-hover hover:text-ink"
      >
        <XIcon size={9} strokeWidth={2.6} />
      </button>
    )}
  </span>
);
PromptBarSource.displayName = "PromptBarSource";

// controlled: the Enter-to-send check reads what the field holds
export interface PromptBarFieldProps extends Omit<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  "onSubmit" | "value"
> {
  value: string;
  onSend?: () => void;
}

const PromptBarField = ({
  className,
  onSend,
  onKeyDown,
  value,
  rows = 1,
  ref,
  ...props
}: PromptBarFieldProps & RefAttributes<HTMLTextAreaElement>) => (
  <textarea
    ref={ref}
    rows={rows}
    value={value}
    data-slot="prompt-bar-field"
    className={cn(
      "w-full resize-none bg-transparent px-3 py-2.5 text-[13.5px] text-ink outline-none",
      "placeholder:text-ink-3",
      className,
    )}
    onKeyDown={(event: KeyboardEvent<HTMLTextAreaElement>) => {
      onKeyDown?.(event);
      if (event.defaultPrevented) {
        return;
      }
      if (event.key !== "Enter" || event.shiftKey) {
        return;
      }
      if ((value ?? "").trim().length === 0) {
        return;
      }
      event.preventDefault();
      onSend?.();
    }}
    {...props}
  />
);
PromptBarField.displayName = "PromptBarField";

const PromptBarToolbar = ({
  className,
  ref,
  ...props
}: HTMLAttributes<HTMLDivElement> & RefAttributes<HTMLDivElement>) => (
  <div
    ref={ref}
    data-slot="prompt-bar-toolbar"
    className={cn("flex items-center gap-1 px-2 pb-2", className)}
    {...props}
  />
);
PromptBarToolbar.displayName = "PromptBarToolbar";

export interface PromptBarActionProps extends HTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  label?: string;
}

const PromptBarAction = ({
  className,
  children,
  active = false,
  label,
  ref,
  ...props
}: PromptBarActionProps & RefAttributes<HTMLButtonElement>) => (
  <button
    ref={ref}
    type="button"
    aria-label={label}
    aria-pressed={active ? true : undefined}
    data-slot="prompt-bar-action"
    className={cn(
      "flex h-7 items-center gap-1.5 rounded-lg px-1.5 text-[12.5px] font-medium",
      "transition-colors duration-100 [&_svg]:size-4 [&_svg]:shrink-0",
      active ? "bg-surface-inset text-ink" : "text-ink-2 hover:bg-hover hover:text-ink",
      className,
    )}
    {...props}
  >
    {children}
  </button>
);
PromptBarAction.displayName = "PromptBarAction";

const PromptBarSend = ({
  className,
  disabled,
  ref,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & RefAttributes<HTMLButtonElement>) => (
  <button
    ref={ref}
    type="button"
    aria-label="Send"
    disabled={disabled}
    data-slot="prompt-bar-send"
    className={cn(
      "ml-auto flex size-7 shrink-0 items-center justify-center rounded-full transition-colors duration-100",
      disabled === true
        ? "bg-surface-inset text-ink-3 opacity-60"
        : "bg-primary text-primary-foreground",
      className,
    )}
    {...props}
  >
    <ArrowUpIcon size={14} strokeWidth={2.4} />
  </button>
);
PromptBarSend.displayName = "PromptBarSend";

export interface PromptBarMenuProps {
  trigger: ReactElement;
  className?: string | undefined;
  children: ReactNode;
}

const PromptBarMenu = ({
  trigger,
  className,
  children,
  ref,
}: PromptBarMenuProps & RefAttributes<HTMLDivElement>) => (
  <DropdownMenu>
    <DropdownMenuTrigger render={trigger} />
    <DropdownMenuContent ref={ref} side="top" className={cn("w-64", className)}>
      {children}
    </DropdownMenuContent>
  </DropdownMenu>
);
PromptBarMenu.displayName = "PromptBarMenu";

// a row with a value is a choice inside a DropdownMenuRadioGroup; without one it is an action
export interface PromptBarMenuItemProps extends HTMLAttributes<HTMLDivElement> {
  icon?: ReactNode;
  meta?: ReactNode;
  value?: string;
  disabled?: boolean;
}

const PromptBarMenuItem = ({
  className,
  children,
  icon,
  meta,
  value,
  disabled = false,
  ref,
  ...props
}: PromptBarMenuItemProps & RefAttributes<HTMLDivElement>) => {
  const rowClassName = cn("[&_svg]:text-ink-3 [&_svg:not([class*='size-'])]:size-3.5", className);
  const row = (
    <>
      {icon}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {meta === undefined ? null : (
        <span className="shrink-0 text-[11.5px] text-ink-3">{meta}</span>
      )}
    </>
  );
  return value === undefined ? (
    <DropdownMenuItem ref={ref} disabled={disabled} className={rowClassName} {...props}>
      {row}
    </DropdownMenuItem>
  ) : (
    <DropdownMenuRadioItem
      ref={ref}
      value={value}
      disabled={disabled}
      className={rowClassName}
      {...props}
    >
      {row}
    </DropdownMenuRadioItem>
  );
};
PromptBarMenuItem.displayName = "PromptBarMenuItem";

export {
  PromptBar,
  PromptBarSources,
  PromptBarSource,
  PromptBarField,
  PromptBarToolbar,
  PromptBarAction,
  PromptBarSend,
  PromptBarMenu,
  PromptBarMenuItem,
  promptBarVariants,
};
