"use client";
// Vendored from Beautiful UI (beautifului.dev), MIT.

import type { HTMLAttributes, InputHTMLAttributes, ReactNode, RefAttributes } from "react";
import { SearchIcon, XIcon } from "lucide-react";

import { cn } from "@repo/ui/lib/cn";
import { GlideList } from "@repo/ui/ai/glide-list";

const SearchPanel = ({
  className,
  ref,
  ...props
}: HTMLAttributes<HTMLDivElement> & RefAttributes<HTMLDivElement>) => (
  <div
    ref={ref}
    data-slot="search-panel"
    className={cn(
      "w-full overflow-hidden rounded-xl bg-surface-raised shadow-surface-2",
      className,
    )}
    {...props}
  />
);
SearchPanel.displayName = "SearchPanel";

// controlled: the clear button shows for what the field holds
export interface SearchFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "value"> {
  value: string;
  onClear?: () => void;
}

const SearchField = ({
  className,
  onClear,
  value,
  ref,
  ...props
}: SearchFieldProps & RefAttributes<HTMLInputElement>) => {
  const filled = value.length > 0;
  return (
    <div
      data-slot="search-field"
      className="flex h-10 items-center gap-2 border-b border-line px-3 transition-colors duration-100 hover:bg-hover"
    >
      <SearchIcon size={14} strokeWidth={2} className="shrink-0 text-ink-3" />
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
            "animate-in fade-in duration-150",
          )}
        >
          <XIcon size={11} strokeWidth={2.2} />
        </button>
      ) : null}
    </div>
  );
};
SearchField.displayName = "SearchField";

const SearchResults = ({
  className,
  children,
  ref,
  ...props
}: HTMLAttributes<HTMLDivElement> & RefAttributes<HTMLDivElement>) => (
  <div ref={ref} data-slot="search-results" className={cn("p-1", className)} {...props}>
    <GlideList className="flex flex-col gap-px" highlightClassName="inset-x-0 rounded-md">
      {children}
    </GlideList>
  </div>
);
SearchResults.displayName = "SearchResults";

const SearchResult = ({
  className,
  ref,
  ...props
}: HTMLAttributes<HTMLButtonElement> & RefAttributes<HTMLButtonElement>) => (
  <button
    ref={ref}
    type="button"
    data-menu-row
    data-slot="search-result"
    className={cn(
      "relative z-10 flex h-8 w-full items-center rounded-md px-2 text-left text-[13px] text-ink",
      "outline-none focus-visible:ring-1 focus-visible:ring-focus-ring",
      className,
    )}
    {...props}
  />
);
SearchResult.displayName = "SearchResult";

export interface SearchEmptyProps extends HTMLAttributes<HTMLDivElement> {
  hint?: ReactNode;
}

const SearchEmpty = ({
  className,
  children,
  hint,
  ref,
  ...props
}: SearchEmptyProps & RefAttributes<HTMLDivElement>) => (
  <div
    ref={ref}
    data-slot="search-empty"
    className={cn(
      "flex flex-col items-center justify-center gap-1 px-4 py-8",
      "animate-in fade-in duration-200",
      className,
    )}
    {...props}
  >
    <span className="mb-1.5 flex size-8 items-center justify-center rounded-lg bg-surface-inset text-ink-3 shadow-surface-1">
      <SearchIcon size={15} strokeWidth={1.8} />
    </span>
    <span className="text-[13px] font-medium text-ink">{children}</span>
    {hint === undefined ? null : <span className="text-[12px] text-ink-3">{hint}</span>}
  </div>
);
SearchEmpty.displayName = "SearchEmpty";

export { SearchPanel, SearchField, SearchResults, SearchResult, SearchEmpty };
