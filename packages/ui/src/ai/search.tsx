"use client";
// Vendored from Beautiful UI (beautifului.dev), MIT.

import { forwardRef } from "react";
import type { HTMLAttributes, InputHTMLAttributes, ReactNode } from "react";

import { cn } from "@repo/ui/lib/utils";
import { GlideList } from "@repo/ui/ai/glide-list";

/* ─────────────────────────────────────────────────────────
 * SEARCH — a command field with its results directly below
 *
 * The QUERY AND RESULTS ARE THE CALLER'S — filtering is their
 * business, since only they know what is being searched — and
 * the sliding highlight comes from `glide-list.tsx`.
 * ───────────────────────────────────────────────────────── */

const SEARCH_ICON = (
  <svg
    aria-hidden
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    className="shrink-0 text-ink-3"
  >
    <circle cx="11" cy="11" r="7" />
    <path d="M21 21l-4.3-4.3" />
  </svg>
);

const SearchPanel = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="search-panel"
      className={cn(
        "w-full overflow-hidden rounded-xl bg-surface-raised shadow-surface-2",
        className,
      )}
      {...props}
    />
  ),
);
SearchPanel.displayName = "SearchPanel";

export interface SearchFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "value"> {
  /** A search draft is text — typed here rather than narrowed at render. */
  value?: string;
  /** Rendered when there is something to clear; the caller owns the reset. */
  onClear?: () => void;
}

const SearchField = forwardRef<HTMLInputElement, SearchFieldProps>(
  ({ className, onClear, value, ...props }, ref) => {
    const filled = (value ?? "").length > 0;
    return (
      <div
        data-slot="search-field"
        className="flex h-10 items-center gap-2 border-b border-line px-3 transition-colors duration-100 hover:bg-hover"
      >
        {SEARCH_ICON}
        <input
          ref={ref}
          value={value}
          className={cn(
            "min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-3",
            className,
          )}
          {...props}
        />
        {filled && onClear !== undefined ? (
          <button
            type="button"
            aria-label="Clear search"
            data-slot="search-clear"
            onClick={onClear}
            className={cn(
              "flex size-6 items-center justify-center rounded-full text-ink-3",
              "transition-colors duration-100 hover:bg-line/70 hover:text-ink",
              "animate-in fade-in duration-150 motion-reduce:animate-none",
            )}
          >
            <svg
              aria-hidden
              width="11"
              height="11"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
            >
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        ) : null}
      </div>
    );
  },
);
SearchField.displayName = "SearchField";

const SearchResults = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, children, ...props }, ref) => (
    <div ref={ref} data-slot="search-results" className={cn("p-1", className)} {...props}>
      <GlideList className="flex flex-col gap-px" highlightClassName="inset-x-0 rounded-md">
        {children}
      </GlideList>
    </div>
  ),
);
SearchResults.displayName = "SearchResults";

const SearchResult = forwardRef<HTMLButtonElement, HTMLAttributes<HTMLButtonElement>>(
  ({ className, ...props }, ref) => (
    <button
      ref={ref}
      type="button"
      data-menu-row
      data-slot="search-result"
      className={cn(
        "relative z-10 flex h-8 w-full items-center rounded-md px-2 text-left text-[13px] text-ink",
        "outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--focus-ring)]",
        className,
      )}
      {...props}
    />
  ),
);
SearchResult.displayName = "SearchResult";

export interface SearchEmptyProps extends HTMLAttributes<HTMLDivElement> {
  /** Second line under the headline — what to try instead. */
  hint?: ReactNode;
}

const SearchEmpty = forwardRef<HTMLDivElement, SearchEmptyProps>(
  ({ className, children, hint, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="search-empty"
      className={cn(
        "flex flex-col items-center justify-center gap-1 px-4 py-8",
        "animate-in fade-in duration-200 motion-reduce:animate-none",
        className,
      )}
      {...props}
    >
      <span className="mb-1.5 flex size-8 items-center justify-center rounded-lg bg-surface-inset text-ink-3 shadow-surface-1">
        <svg
          aria-hidden
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="M21 21l-4.3-4.3" />
        </svg>
      </span>
      <span className="text-[13px] font-medium text-ink">{children}</span>
      {hint === undefined ? null : <span className="text-[12px] text-ink-3">{hint}</span>}
    </div>
  ),
);
SearchEmpty.displayName = "SearchEmpty";

export { SearchPanel, SearchField, SearchResults, SearchResult, SearchEmpty };
