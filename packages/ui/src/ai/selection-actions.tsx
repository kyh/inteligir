"use client";
// Vendored from Beautiful UI (beautifului.dev), MIT. Its result card is cut: no surface shows a
// transformed selection, and the library's selection strip is the bar alone.

import type { HTMLAttributes, ReactNode, RefAttributes } from "react";
import { ChevronRightIcon } from "lucide-react";

import { cn } from "@repo/ui/lib/cn";

const SelectionActions = ({
  className,
  ref,
  ...props
}: HTMLAttributes<HTMLDivElement> & RefAttributes<HTMLDivElement>) => (
  <div
    ref={ref}
    role="toolbar"
    data-slot="selection-actions"
    className={cn(
      "inline-flex items-center gap-px rounded-xl bg-surface-raised p-1 shadow-surface-3",
      "animate-in fade-in zoom-in-95 duration-150",
      className,
    )}
    {...props}
  />
);

interface SelectionActionProps extends HTMLAttributes<HTMLButtonElement> {
  icon?: ReactNode;
  hasMenu?: boolean;
}

const SelectionAction = ({
  className,
  children,
  icon,
  hasMenu = false,
  ref,
  ...props
}: SelectionActionProps & RefAttributes<HTMLButtonElement>) => (
  <button
    ref={ref}
    type="button"
    data-slot="selection-action"
    className={cn(
      "flex h-7 items-center gap-1.5 rounded-lg px-2 text-body font-medium text-ink",
      "transition-colors duration-100 hover:bg-hover",
      "outline-none focus-visible:ring-1 focus-visible:ring-focus-ring",
      "[&_svg]:size-3.5 [&_svg]:shrink-0 [&_svg]:text-ink-2",
      className,
    )}
    {...props}
  >
    {icon}
    {children}
    {hasMenu ? <ChevronRightIcon size={10} strokeWidth={2.5} className="text-ink-3" /> : null}
  </button>
);

const SelectionActionsSeparator = ({
  className,
  ref,
  ...props
}: HTMLAttributes<HTMLSpanElement> & RefAttributes<HTMLSpanElement>) => (
  <span
    ref={ref}
    aria-hidden
    data-slot="selection-actions-separator"
    className={cn("mx-0.5 h-4 w-px shrink-0 bg-line", className)}
    {...props}
  />
);

const Shimmer = ({
  className,
  ref,
  ...props
}: HTMLAttributes<HTMLSpanElement> & RefAttributes<HTMLSpanElement>) => (
  <span ref={ref} data-slot="shimmer" className={cn("bui-shimmer-text", className)} {...props} />
);

export { SelectionActions, SelectionAction, SelectionActionsSeparator, Shimmer };
