"use client";
// Vendored from Beautiful UI (beautifului.dev), MIT.

import { forwardRef } from "react";
import type { HTMLAttributes, ReactNode } from "react";

import { cn } from "@repo/ui/lib/utils";

/* ─────────────────────────────────────────────────────────
 * SELECTION ACTIONS — the bar that appears over a selection,
 * and the result panel an action opens
 *
 * Upstream drives a scripted rewrite through a fixture and pulls
 * icons from `iconoir-react` plus two of its own atoms
 * (`Shimmer`, `StreamText`) that its payload does not ship. Icons
 * are now a SLOT — this package already has `lucide-react` and a
 * caller may want neither — the shimmer is the `shimmer-text`
 * keyframe this directory already defines, and streamed text is
 * `streaming-text.tsx`, which is right here.
 * ───────────────────────────────────────────────────────── */

const SelectionActions = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
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
  ),
);
SelectionActions.displayName = "SelectionActions";

export interface SelectionActionProps extends HTMLAttributes<HTMLButtonElement> {
  /** Leading glyph — the caller's own icon element. */
  icon?: ReactNode;
  /** Shows a chevron, marking the action as opening more. */
  hasMenu?: boolean;
}

const SelectionAction = forwardRef<HTMLButtonElement, SelectionActionProps>(
  ({ className, children, icon, hasMenu = false, ...props }, ref) => (
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
  ),
);
SelectionAction.displayName = "SelectionAction";

const SelectionActionsSeparator = forwardRef<HTMLSpanElement, HTMLAttributes<HTMLSpanElement>>(
  ({ className, ...props }, ref) => (
    <span
      ref={ref}
      aria-hidden
      data-slot="selection-actions-separator"
      className={cn("mx-0.5 h-4 w-px shrink-0 bg-line", className)}
      {...props}
    />
  ),
);
SelectionActionsSeparator.displayName = "SelectionActionsSeparator";

/** The "working on it" label: a highlight sweeping across the words. Uses the
 *  `shimmer-text` keyframe this directory already ships, which the reduced-
 *  motion block in globals.css switches off. */
const Shimmer = forwardRef<HTMLSpanElement, HTMLAttributes<HTMLSpanElement>>(
  ({ className, ...props }, ref) => (
    <span ref={ref} data-slot="shimmer" className={cn("bui-shimmer-text", className)} {...props} />
  ),
);
Shimmer.displayName = "Shimmer";

const SelectionResult = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
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
  ),
);
SelectionResult.displayName = "SelectionResult";

export interface SelectionResultHeaderProps extends HTMLAttributes<HTMLDivElement> {
  icon?: ReactNode;
}

const SelectionResultHeader = forwardRef<HTMLDivElement, SelectionResultHeaderProps>(
  ({ className, children, icon, ...props }, ref) => (
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
  ),
);
SelectionResultHeader.displayName = "SelectionResultHeader";

const SelectionResultBody = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="selection-result-body"
      className={cn("px-3 py-2.5 text-[13px] leading-relaxed text-ink", className)}
      {...props}
    />
  ),
);
SelectionResultBody.displayName = "SelectionResultBody";

export interface SelectionResultFooterProps extends HTMLAttributes<HTMLDivElement> {
  /** Accept / discard — the caller's own controls. */
  actions?: ReactNode;
}

const SelectionResultFooter = forwardRef<HTMLDivElement, SelectionResultFooterProps>(
  ({ className, children, actions, ...props }, ref) => (
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
  ),
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
