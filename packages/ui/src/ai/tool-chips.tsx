"use client";
// Vendored from Beautiful UI (beautifului.dev), MIT.

import {
  Children,
  createContext,
  forwardRef,
  useContext,
  useMemo,
  useState,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { Collapse } from "@repo/ui/lib/collapse";
import { cn } from "@repo/ui/lib/utils";

/* ─────────────────────────────────────────────────────────
 * TOOL CHIPS — what the agent ran, one row per call
 *
 * A collapsible run header over rows that each carry a chip
 * (the call's target) and expand to their own detail lines.
 *
 * Upstream animates a fixture in on a timer and ends with
 * hover-preview diff chips. The ROWS ARE THE INPUT here, and
 * the diff chips are dropped: they render hunks this
 * product's timeline does not carry, so they would be a
 * hover surface with nothing behind it.
 * ───────────────────────────────────────────────────────── */

const ICONS = {
  think: <path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z" />,
  write: (
    <g
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z" />
    </g>
  ),
  run: (
    <g
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 17l6-5-6-5M12 19h8" />
    </g>
  ),
  read: (
    <g
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
    </g>
  ),
} satisfies Record<ToolIcon, ReactNode>;

const toolChipVariants = cva(
  "group/row -mx-[3px] flex h-7 w-[calc(100%+6px)] min-w-0 items-center gap-2 rounded-md px-[3px] text-left transition-colors duration-100 enabled:hover:bg-hover",
  {
    variants: {
      icon: { think: "", write: "", run: "", read: "" },
    },
    defaultVariants: { icon: "think" },
  },
);

type ToolIcon = NonNullable<VariantProps<typeof toolChipVariants>["icon"]>;

interface ToolChipContextValue {
  open: boolean;
  mono: boolean;
}

const ToolChipContext = createContext<ToolChipContextValue>({ open: false, mono: false });

interface ToolChipListProps extends HTMLAttributes<HTMLDivElement> {
  /** The run header — "4 tool calls, 2 messages". */
  summary: string;
  defaultExpanded?: boolean;
}

const ToolChipList = forwardRef<HTMLDivElement, ToolChipListProps>(
  ({ summary, defaultExpanded = true, className, children, ...props }, ref) => {
    const [open, setOpen] = useState(defaultExpanded);
    return (
      <div ref={ref} data-slot="tool-chip-list" className={cn("w-full pb-1", className)} {...props}>
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          data-slot="tool-chip-list-trigger"
          className="-mx-1.5 flex w-fit items-center gap-1.5 rounded-md px-1.5 py-1 text-[12.5px] text-ink-2 transition-colors duration-100 hover:bg-hover"
        >
          <svg
            aria-hidden
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={cn("transition-transform duration-200", !open && "-rotate-90")}
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
          <span className="tabular-nums">{summary}</span>
        </button>

        {/* -mx-1 + px-1.5 keeps content at the same x while giving the row
            hover pills room inside the collapse's clip box. */}
        <Collapse open={open} innerClassName="-mx-1 px-1.5 pb-1">
          <div className="mt-1.5 flex flex-col gap-1">{children}</div>
        </Collapse>
      </div>
    );
  },
);
ToolChipList.displayName = "ToolChipList";

interface ToolChipProps
  extends HTMLAttributes<HTMLDivElement>, VariantProps<typeof toolChipVariants> {
  /** "Write 204 lines", "Rebuild and verify". */
  label: string;
  /** The call's target — a path, a command, a one-line summary. */
  chip: string;
  /** Render the chip in the mono face (paths, commands). */
  mono?: boolean;
  /** Render the detail lines in the mono face. */
  detailMono?: boolean;
}

/** Children are the chip's detail lines: a chip with none is not expandable,
 *  which is the same rule upstream applied to an empty detail array. */
const ToolChip = forwardRef<HTMLDivElement, ToolChipProps>(
  (
    {
      icon = "think",
      label,
      chip,
      mono = false,
      detailMono = false,
      className,
      children,
      ...props
    },
    ref,
  ) => {
    const [open, setOpen] = useState(false);
    const expandable = Children.count(children) > 0;
    const chipIcon = icon ?? "think";
    const detailContext = useMemo(() => ({ open, mono: detailMono }), [open, detailMono]);
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
          onClick={() => setOpen(!open)}
          className={toolChipVariants({ icon: chipIcon })}
        >
          <span className="relative flex size-4 shrink-0 items-center justify-center text-ink-3">
            <svg
              aria-hidden
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill={chipIcon === "think" ? "currentColor" : "none"}
              stroke="currentColor"
              className={cn(
                "transition-opacity duration-100",
                expandable && "group-hover/row:opacity-0",
                open && "opacity-0",
              )}
            >
              {ICONS[chipIcon]}
            </svg>
            {expandable ? (
              <svg
                aria-hidden
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={cn(
                  "absolute transition-[opacity,transform] duration-150 group-hover/row:opacity-100",
                  open ? "rotate-0 opacity-100" : "-rotate-90 opacity-0",
                )}
              >
                <path d="M6 9l6 6 6-6" />
              </svg>
            ) : null}
          </span>
          <span className="shrink-0 text-[12.5px] font-medium text-ink">{label}</span>
          <span
            className={cn(
              "inline-flex h-5.5 min-w-0 flex-1 items-center truncate rounded-md bg-muted px-1.5 text-[11.5px] text-ink-2",
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
  },
);
ToolChip.displayName = "ToolChip";

interface ToolChipDetailProps extends HTMLAttributes<HTMLSpanElement> {
  /** An added line renders in the diff-add ink. */
  tone?: "add";
}

const ToolChipDetail = forwardRef<HTMLSpanElement, ToolChipDetailProps>(
  ({ tone, className, children, ...props }, ref) => {
    const { mono } = useContext(ToolChipContext);
    return (
      <span
        ref={ref}
        data-slot="tool-chip-detail"
        className={cn(
          "truncate text-[11.5px] leading-[1.6]",
          mono && "font-mono",
          tone === "add" ? "text-emerald-500" : "text-ink-2",
          className,
        )}
        {...props}
      >
        {children}
      </span>
    );
  },
);
ToolChipDetail.displayName = "ToolChipDetail";

export { ToolChipList, ToolChip, ToolChipDetail };
