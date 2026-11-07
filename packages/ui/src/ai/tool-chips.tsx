"use client";
// Vendored from Beautiful UI (beautifului.dev), MIT.

import { Children, useState } from "react";
import type { HTMLAttributes, ReactNode, RefAttributes } from "react";
import { ChevronDownIcon, FileIcon, PenIcon } from "lucide-react";

import { Collapse } from "@repo/ui/lib/collapse";
import { cn } from "@repo/ui/lib/cn";

type ToolIcon = "read" | "write";

const ICONS = {
  read: <FileIcon size={13} />,
  write: <PenIcon size={13} />,
} satisfies Record<ToolIcon, ReactNode>;

interface ToolChipListProps extends HTMLAttributes<HTMLDivElement> {
  summary: string;
}

const ToolChipList = ({
  summary,
  className,
  children,
  ref,
  ...props
}: ToolChipListProps & RefAttributes<HTMLDivElement>) => {
  const [open, setOpen] = useState(true);
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

interface ToolChipProps extends HTMLAttributes<HTMLDivElement> {
  icon: ToolIcon;
  label: string;
  chip: string;
  failed?: boolean;
}

const ToolChip = ({
  icon,
  label,
  chip,
  failed = false,
  className,
  children,
  ref,
  ...props
}: ToolChipProps & RefAttributes<HTMLDivElement>) => {
  const [open, setOpen] = useState(false);
  // oxlint-disable-next-line react/no-react-children -- expandability is exactly "did the caller pass a body", and only Children.count reads array and hole children the way React renders them
  const expandable = Children.count(children) > 0;
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
        <span
          className={cn("shrink-0 text-body font-medium", failed ? "text-destructive" : "text-ink")}
        >
          {label}
        </span>
        <span className="inline-flex h-5.5 min-w-0 flex-1 items-center truncate rounded-md bg-muted px-1.5 text-caption text-ink-2">
          {chip}
        </span>
      </button>

      {expandable ? (
        <Collapse open={open} innerClassName="min-h-0">
          <div className="mt-0.5 mb-1 ml-2 flex flex-col gap-0.5 border-l border-line py-0.5 pl-3.5">
            {children}
          </div>
        </Collapse>
      ) : null}
    </div>
  );
};

const ToolChipDetail = ({
  className,
  children,
  ref,
  ...props
}: HTMLAttributes<HTMLSpanElement> & RefAttributes<HTMLSpanElement>) => (
  <span
    ref={ref}
    data-slot="tool-chip-detail"
    className={cn("truncate text-caption leading-[1.6] text-ink-2", className)}
    {...props}
  >
    {children}
  </span>
);

export { ToolChipList, ToolChip, ToolChipDetail };
