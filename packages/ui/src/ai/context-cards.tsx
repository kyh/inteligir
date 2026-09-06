"use client";
// Vendored from Beautiful UI (beautifului.dev), MIT.

import { forwardRef, type HTMLAttributes, type ReactNode } from "react";

import { cn } from "cn";

const LINES_ICON = (
  <svg
    aria-hidden
    width="11"
    height="11"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
  >
    <path d="M4 6h16M4 12h16M4 18h10" />
  </svg>
);

const OPEN_ICON = (
  <svg
    aria-hidden
    width="9"
    height="9"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M7 17L17 7M7 7h10v10" />
  </svg>
);

const ContextCardList = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, children, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="context-card-list"
      className={cn("flex w-full flex-col gap-2", className)}
      {...props}
    >
      {children}
    </div>
  ),
);
ContextCardList.displayName = "ContextCardList";

export interface ContextCardListHeadingProps extends HTMLAttributes<HTMLDivElement> {
  count?: ReactNode;
}

const ContextCardListHeading = forwardRef<HTMLDivElement, ContextCardListHeadingProps>(
  ({ className, children, count, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="context-card-list-heading"
      className={cn("flex items-center gap-2 px-0.5", className)}
      {...props}
    >
      <span className="text-[13px] font-semibold text-ink">{children}</span>
      {count === undefined ? null : (
        <span className="inline-flex h-5 items-center rounded-md bg-surface-inset px-1.5 text-[11.5px] font-medium text-ink-2 tabular-nums">
          {count}
        </span>
      )}
    </div>
  ),
);
ContextCardListHeading.displayName = "ContextCardListHeading";

export interface ContextCardProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  title: ReactNode;
  extent?: ReactNode;
}

const ContextCard = forwardRef<HTMLDivElement, ContextCardProps>(
  ({ className, children, title, extent, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="context-card"
      className={cn(
        "overflow-hidden rounded-xl bg-surface-raised shadow-surface-2",
        "animate-in fade-in slide-in-from-bottom-1 duration-300 motion-reduce:animate-none",
        className,
      )}
      {...props}
    >
      <div className="flex items-center gap-2.5 border-b border-line px-3 py-2">
        <span className="flex min-w-0 items-center gap-1.5 text-[13px] font-medium text-ink">
          {LINES_ICON}
          <span className="truncate">{title}</span>
        </span>
        {extent === undefined ? null : (
          <span className="ml-auto shrink-0 text-[12px] text-ink-3 tabular-nums">{extent}</span>
        )}
      </div>
      {children}
    </div>
  ),
);
ContextCard.displayName = "ContextCard";

const ContextCardBody = forwardRef<HTMLParagraphElement, HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <p
      ref={ref}
      data-slot="context-card-body"
      className={cn("px-3 pt-2 pb-1 text-[12.5px] leading-relaxed text-ink-2", className)}
      {...props}
    />
  ),
);
ContextCardBody.displayName = "ContextCardBody";

export interface ContextCardSourceProps extends HTMLAttributes<HTMLButtonElement> {
  kind?: ReactNode;
}

const ContextCardSource = forwardRef<HTMLButtonElement, ContextCardSourceProps>(
  ({ className, children, kind, ...props }, ref) => (
    <div className="px-3 pb-3">
      <button
        ref={ref}
        type="button"
        data-slot="context-card-source"
        className={cn(
          "inline-flex h-6 items-center gap-1.5 rounded-full bg-surface-inset px-2",
          "text-[12px] font-medium text-ink-2 transition-colors hover:bg-hover",
          className,
        )}
        {...props}
      >
        {kind === undefined ? null : (
          <span className="flex size-3.5 items-center justify-center rounded-[4px] bg-line text-[7px] font-bold text-ink">
            {kind}
          </span>
        )}
        {children}
        {OPEN_ICON}
      </button>
    </div>
  ),
);
ContextCardSource.displayName = "ContextCardSource";

export { ContextCardList, ContextCardListHeading, ContextCard, ContextCardBody, ContextCardSource };
