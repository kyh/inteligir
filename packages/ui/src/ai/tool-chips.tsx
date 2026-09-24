"use client";
// Vendored from Beautiful UI (beautifului.dev), MIT.

import { Children, createContext, useContext, useMemo, useState } from "react";
import type { HTMLAttributes, ReactNode, RefAttributes } from "react";
import { ChevronDownIcon, FileIcon, PenIcon, TerminalIcon } from "lucide-react";

import { Collapse } from "@repo/ui/lib/collapse";
import { cn } from "@repo/ui/lib/cn";

type ToolIcon = "read" | "run" | "think" | "write";

// the think mark is the straight four-point star the thinking trace draws; lucide's sparkle bows
const ICONS = {
  read: <FileIcon size={13} />,
  run: <TerminalIcon size={13} />,
  think: (
    <svg aria-hidden width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z" />
    </svg>
  ),
  write: <PenIcon size={13} />,
} satisfies Record<ToolIcon, ReactNode>;

interface ToolChipContextValue {
  mono: boolean;
}

const ToolChipContext = createContext<ToolChipContextValue>({ mono: false });

interface ToolChipListProps extends HTMLAttributes<HTMLDivElement> {
  summary: string;
  defaultExpanded?: boolean;
}

const ToolChipList = ({
  summary,
  defaultExpanded = true,
  className,
  children,
  ref,
  ...props
}: ToolChipListProps & RefAttributes<HTMLDivElement>) => {
  const [open, setOpen] = useState(defaultExpanded);
  // the collapse's -mx-1 + px-1.5 keeps x while giving hover pills room inside its clip box
  return (
    <div ref={ref} data-slot="tool-chip-list" className={cn("w-full pb-1", className)} {...props}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => {
          setOpen(!open);
        }}
        data-slot="tool-chip-list-trigger"
        className="-mx-1.5 flex w-fit items-center gap-1.5 rounded-md px-1.5 py-1 text-body text-ink-2 transition-colors duration-100 hover:bg-hover"
      >
        <ChevronDownIcon
          size={12}
          strokeWidth={2.2}
          className={cn("transition-transform duration-200", !open && "-rotate-90")}
        />
        <span className="tabular-nums">{summary}</span>
      </button>

      <Collapse open={open} innerClassName="-mx-1 px-1.5 pb-1">
        <div className="mt-1.5 flex flex-col gap-1">{children}</div>
      </Collapse>
    </div>
  );
};
ToolChipList.displayName = "ToolChipList";

interface ToolChipProps extends HTMLAttributes<HTMLDivElement> {
  icon?: ToolIcon;
  label: string;
  chip: string;
  mono?: boolean;
  detailMono?: boolean;
}

const ToolChip = ({
  icon = "think",
  label,
  chip,
  mono = false,
  detailMono = false,
  className,
  children,
  ref,
  ...props
}: ToolChipProps & RefAttributes<HTMLDivElement>) => {
  const [open, setOpen] = useState(false);
  // oxlint-disable-next-line react/no-react-children -- expandability is exactly "did the caller pass a body", and only Children.count reads array and hole children the way React renders them
  const expandable = Children.count(children) > 0;
  const detailContext = useMemo(() => ({ mono: detailMono }), [detailMono]);
  return (
    <div
      ref={ref}
      data-slot="tool-chip"
      className={cn("animate-in fade-in slide-in-from-bottom-1", className)}
      {...props}
    >
      <button
        type="button"
        aria-expanded={expandable ? open : undefined}
        disabled={!expandable}
        onClick={() => {
          setOpen(!open);
        }}
        className="group/row -mx-[3px] flex h-7 w-[calc(100%+6px)] min-w-0 items-center gap-2 rounded-md px-[3px] text-left transition-colors duration-100 enabled:hover:bg-hover"
      >
        <span className="relative flex size-4 shrink-0 items-center justify-center text-ink-3">
          <span
            className={cn(
              "flex transition-opacity duration-100",
              expandable && "group-hover/row:opacity-0",
              open && "opacity-0",
            )}
          >
            {ICONS[icon]}
          </span>
          {expandable ? (
            <ChevronDownIcon
              size={12}
              strokeWidth={2.2}
              className={cn(
                "absolute transition-[opacity,transform] duration-150 group-hover/row:opacity-100",
                open ? "rotate-0 opacity-100" : "-rotate-90 opacity-0",
              )}
            />
          ) : null}
        </span>
        <span className="shrink-0 text-body font-medium text-ink">{label}</span>
        <span
          className={cn(
            "inline-flex h-5.5 min-w-0 flex-1 items-center truncate rounded-md bg-muted px-1.5 text-caption text-ink-2",
            mono && "font-mono",
          )}
        >
          {chip}
        </span>
      </button>

      {expandable ? (
        <Collapse open={open} innerClassName="min-h-0">
          <ToolChipContext.Provider value={detailContext}>
            <div className="mt-0.5 mb-1 ml-2 flex flex-col gap-0.5 border-l border-line py-0.5 pl-3.5">
              {children}
            </div>
          </ToolChipContext.Provider>
        </Collapse>
      ) : null}
    </div>
  );
};
ToolChip.displayName = "ToolChip";

interface ToolChipDetailProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: "add";
}

const ToolChipDetail = ({
  tone,
  className,
  children,
  ref,
  ...props
}: ToolChipDetailProps & RefAttributes<HTMLSpanElement>) => {
  const { mono } = useContext(ToolChipContext);
  return (
    <span
      ref={ref}
      data-slot="tool-chip-detail"
      className={cn(
        "truncate text-caption leading-[1.6]",
        mono && "font-mono",
        tone === "add" ? "text-success" : "text-ink-2",
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
};
ToolChipDetail.displayName = "ToolChipDetail";

export { ToolChipList, ToolChip, ToolChipDetail };
