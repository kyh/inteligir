"use client";
// Vendored from Beautiful UI (beautifului.dev), MIT.

import type { HTMLAttributes, ReactNode, RefAttributes } from "react";

import { cn } from "cn";

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
      "animate-in fade-in zoom-in-95 duration-150 motion-reduce:animate-none",
      className,
    )}
    {...props}
  />
);
SelectionActions.displayName = "SelectionActions";

export interface SelectionActionProps extends HTMLAttributes<HTMLButtonElement> {
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
      "flex h-7 items-center gap-1.5 rounded-lg px-2 text-[12.5px] font-medium text-ink",
      "transition-colors duration-100 hover:bg-hover",
      "outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--focus-ring)]",
      "[&_svg]:size-3.5 [&_svg]:shrink-0 [&_svg]:text-ink-2",
      className,
    )}
    {...props}
  >
    {icon}
    {children}
    {hasMenu ? (
      <svg
        aria-hidden
        width="10"
        height="10"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="text-ink-3"
      >
        <path d="M9 6l6 6-6 6" />
      </svg>
    ) : null}
  </button>
);
SelectionAction.displayName = "SelectionAction";

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
SelectionActionsSeparator.displayName = "SelectionActionsSeparator";

const Shimmer = ({
  className,
  ref,
  ...props
}: HTMLAttributes<HTMLSpanElement> & RefAttributes<HTMLSpanElement>) => (
  <span ref={ref} data-slot="shimmer" className={cn("bui-shimmer-text", className)} {...props} />
);
Shimmer.displayName = "Shimmer";

const SelectionResult = ({
  className,
  ref,
  ...props
}: HTMLAttributes<HTMLDivElement> & RefAttributes<HTMLDivElement>) => (
  <div
    ref={ref}
    data-slot="selection-result"
    className={cn(
      "w-full overflow-hidden rounded-xl bg-surface-raised shadow-surface-2",
      "animate-in fade-in slide-in-from-top-1 duration-200 motion-reduce:animate-none",
      className,
    )}
    {...props}
  />
);
SelectionResult.displayName = "SelectionResult";

export interface SelectionResultHeaderProps extends HTMLAttributes<HTMLDivElement> {
  icon?: ReactNode;
}

const SelectionResultHeader = ({
  className,
  children,
  icon,
  ref,
  ...props
}: SelectionResultHeaderProps & RefAttributes<HTMLDivElement>) => (
  <div
    ref={ref}
    data-slot="selection-result-header"
    className={cn(
      "flex items-center gap-1.5 border-b border-line px-3 py-2 text-[12px] font-medium text-ink-2",
      "[&_svg]:size-3.5 [&_svg]:shrink-0",
      className,
    )}
    {...props}
  >
    {icon}
    {children}
  </div>
);
SelectionResultHeader.displayName = "SelectionResultHeader";

const SelectionResultBody = ({
  className,
  ref,
  ...props
}: HTMLAttributes<HTMLDivElement> & RefAttributes<HTMLDivElement>) => (
  <div
    ref={ref}
    data-slot="selection-result-body"
    className={cn("px-3 py-2.5 text-[13px] leading-relaxed text-ink", className)}
    {...props}
  />
);
SelectionResultBody.displayName = "SelectionResultBody";

export interface SelectionResultFooterProps extends HTMLAttributes<HTMLDivElement> {
  actions?: ReactNode;
}

const SelectionResultFooter = ({
  className,
  children,
  actions,
  ref,
  ...props
}: SelectionResultFooterProps & RefAttributes<HTMLDivElement>) => (
  <div
    ref={ref}
    data-slot="selection-result-footer"
    className={cn(
      "flex items-center justify-between gap-3 border-t border-line px-3 py-2",
      className,
    )}
    {...props}
  >
    <span className="text-[11.5px] text-ink-3">{children}</span>
    {actions === undefined ? null : <span className="flex items-center gap-1.5">{actions}</span>}
  </div>
);
SelectionResultFooter.displayName = "SelectionResultFooter";

export {
  SelectionActions,
  SelectionAction,
  SelectionActionsSeparator,
  Shimmer,
  SelectionResult,
  SelectionResultHeader,
  SelectionResultBody,
  SelectionResultFooter,
};
