"use client";
// Vendored from Beautiful UI (beautifului.dev), MIT.

import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  KeyboardEvent,
  ReactNode,
  RefAttributes,
  TextareaHTMLAttributes,
} from "react";
import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";

import { cn } from "@repo/ui/lib/cn";
import { GlideList } from "@repo/ui/ai/glide-list";

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
        <svg
          aria-hidden
          width="9"
          height="9"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.6"
          strokeLinecap="round"
        >
          <path d="M18 6L6 18M6 6l12 12" />
        </svg>
      </button>
    )}
  </span>
);
PromptBarSource.displayName = "PromptBarSource";

export interface PromptBarFieldProps extends Omit<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  "onSubmit" | "value"
> {
  value?: string;
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
    <svg
      aria-hidden
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 19V5M5 12l7-7 7 7" />
    </svg>
  </button>
);
PromptBarSend.displayName = "PromptBarSend";

const PromptBarMenu = ({
  className,
  children,
  ref,
  ...props
}: HTMLAttributes<HTMLDivElement> & RefAttributes<HTMLDivElement>) => (
  <div
    ref={ref}
    // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- <select> cannot render the icon and meta rows this menu draws
    role="listbox"
    data-slot="prompt-bar-menu"
    className={cn(
      "w-64 overflow-hidden rounded-xl bg-surface-raised p-1 shadow-surface-3",
      "animate-in fade-in slide-in-from-bottom-1 duration-150 motion-reduce:animate-none",
      className,
    )}
    {...props}
  >
    <GlideList className="flex flex-col gap-px" highlightClassName="inset-x-0 rounded-md">
      {children}
    </GlideList>
  </div>
);
PromptBarMenu.displayName = "PromptBarMenu";

export interface PromptBarMenuItemProps extends HTMLAttributes<HTMLButtonElement> {
  icon?: ReactNode;
  meta?: ReactNode;
  selected?: boolean;
}

const PromptBarMenuItem = ({
  className,
  children,
  icon,
  meta,
  selected = false,
  ref,
  ...props
}: PromptBarMenuItemProps & RefAttributes<HTMLButtonElement>) => (
  <button
    ref={ref}
    type="button"
    // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- <option> cannot render the icon and meta rows this menu draws
    role="option"
    aria-selected={selected}
    data-menu-row
    data-slot="prompt-bar-menu-item"
    className={cn(
      "relative z-10 flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] text-ink",
      "outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--focus-ring)]",
      "[&_svg]:size-3.5 [&_svg]:shrink-0 [&_svg]:text-ink-3",
      className,
    )}
    {...props}
  >
    {icon}
    <span className="min-w-0 flex-1 truncate">{children}</span>
    {meta === undefined ? null : <span className="shrink-0 text-[11.5px] text-ink-3">{meta}</span>}
  </button>
);
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
