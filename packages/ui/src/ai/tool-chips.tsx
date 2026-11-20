"use client";
// @license MIT, vendored from Beautiful UI (beautifului.dev).

import { useState } from "react";
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

  return (
    <div ref={ref} data-slot="tool-chip-list" className={cn("w-full pb-1", className)} {...props}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => {
          setOpen(!open);
        }}
        data-slot="tool-chip-list-trigger"
        className="-mx-1.5 flex w-fit items-center gap-1.5 rounded-md px-1.5 py-1 text-body text-muted-foreground transition-colors duration-100 hover:bg-hover"
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

type ToolUse =
  | { readonly kind: "running" }
  | { readonly kind: "done" }
  | { readonly kind: "failed"; readonly message: string };

interface ToolChipProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  icon: ToolIcon;
  label: string;
  use: ToolUse;
}

const ToolChip = ({
  icon,
  label,
  use,
  className,
  ref,
  ...props
}: ToolChipProps & RefAttributes<HTMLDivElement>) => {
  const [open, setOpen] = useState(false);
  const failed = use.kind === "failed";

  return (
    <div
      ref={ref}
      data-slot="tool-chip"
      className={cn("animate-in fade-in slide-in-from-bottom-1", className)}
      {...props}
    >
      <button
        type="button"
        aria-expanded={failed ? open : undefined}
        disabled={!failed}
        onClick={() => {
          setOpen(!open);
        }}
        className="group/row -mx-[3px] flex h-7 w-[calc(100%+6px)] min-w-0 items-center gap-2 rounded-md px-[3px] text-left transition-colors duration-100 enabled:hover:bg-hover"
      >
        <span className="relative flex size-4 shrink-0 items-center justify-center text-ink-3">
          <span
            className={cn(
              "flex transition-opacity duration-100",
              failed && "group-hover/row:opacity-0",
              open && "opacity-0",
            )}
          >
            {ICONS[icon]}
          </span>
          {failed ? (
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
          className={cn(
            "shrink-0 text-body font-medium",
            failed ? "text-destructive" : "text-foreground",
          )}
        >
          {label}
        </span>
        {use.kind === "running" ? (
          <span className="inline-flex h-5.5 min-w-0 flex-1 items-center truncate rounded-md bg-muted px-1.5 text-caption text-muted-foreground">
            …
          </span>
        ) : null}
      </button>

      {failed ? (
        <Collapse open={open} innerClassName="min-h-0">
          <div className="mt-0.5 mb-1 ml-2 flex flex-col border-l border-border py-0.5 pl-3.5">
            <span
              data-slot="tool-chip-detail"
              className="truncate text-caption leading-[1.6] text-muted-foreground"
            >
              {use.message}
            </span>
          </div>
        </Collapse>
      ) : null}
    </div>
  );
};

export { ToolChipList, ToolChip };
