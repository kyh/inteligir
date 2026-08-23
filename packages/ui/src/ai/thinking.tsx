"use client";
// Vendored from Beautiful UI (beautifului.dev), MIT.

import { useLayoutEffect, useRef, useState } from "react";

import { cn } from "@repo/ui/lib/utils";

/* ─────────────────────────────────────────────────────────
 * THINKING — a collapsible trace of what the agent did
 *
 * Header shimmers while working and settles to a summary;
 * the trace hangs off a vertical rule, one row per step.
 *
 * Upstream ships four fixture-driven variants on a canned
 * timer (Steps / Reasoning / Search / Coding). Here the ROWS
 * ARE THE INPUT and each carries its own kind, because a real
 * turn interleaves reasoning and tool calls in one trace —
 * upstream's Search variant is dropped whole: it renders web
 * sources this product has none of.
 * ───────────────────────────────────────────────────────── */

export type ThinkingRowKind = "step" | "reasoning" | "tool";

export interface ThinkingRow {
  /** Stable across re-renders — a growing trace must not re-key. */
  id: string;
  kind: ThinkingRowKind;
  primary: string;
  /** A path, a count, a target — shown dimmed after the primary. */
  secondary?: string;
  /** Render `secondary` in the mono face (paths, commands). */
  mono?: boolean;
  /** Diff counts for an edit row. */
  added?: number;
  removed?: number;
  /** A step still in flight draws the spinner instead of the check. */
  pending?: boolean;
  onSelect?: () => void;
  selected?: boolean;
}

function RowIcon({ row }: { row: ThinkingRow }) {
  if (row.kind === "reasoning") return null;
  if (row.pending === true) {
    return (
      <span
        aria-hidden
        className="size-3 shrink-0 animate-spin rounded-full border-[1.5px] border-line-strong border-t-ink-2"
      />
    );
  }
  return (
    <svg
      aria-hidden
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="var(--ink-3)"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0"
    >
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}

function RowBody({ row }: { row: ThinkingRow }) {
  return (
    <>
      <RowIcon row={row} />
      <span
        className={cn(
          "min-w-0 truncate text-[12.5px]",
          row.kind === "reasoning"
            ? "whitespace-normal leading-relaxed text-ink-2"
            : "font-medium text-ink",
        )}
      >
        {row.primary}
      </span>
      {row.secondary !== undefined ? (
        <span className={cn("shrink-0 text-[11.5px] text-ink-3", row.mono === true && "font-mono")}>
          {row.secondary}
        </span>
      ) : null}
      {row.added !== undefined || row.removed !== undefined ? (
        <span className="shrink-0 font-mono text-[11px] tabular-nums">
          <span className="text-emerald-500">+{row.added ?? 0}</span>{" "}
          <span className="text-destructive">−{row.removed ?? 0}</span>
        </span>
      ) : null}
    </>
  );
}

const ROW_CLASS = "flex min-h-7 w-full items-center gap-2 rounded-[6px] px-1.5 py-0.5 text-left";

export interface ThinkingProps {
  /** Shown, shimmering, while `working`. */
  label?: string;
  /** Shown once settled — "Thought for 4s", "Ran 3 tools". */
  doneLabel: string;
  working?: boolean;
  rows: readonly ThinkingRow[];
  /** Open on first render; the reader's own toggle wins afterwards. */
  defaultExpanded?: boolean;
  className?: string;
}

export function Thinking({
  label = "Thinking",
  doneLabel,
  working = false,
  rows,
  defaultExpanded = false,
  className,
}: ThinkingProps) {
  const [manualExpanded, setManualExpanded] = useState<boolean | null>(null);
  const expanded = manualExpanded ?? defaultExpanded;
  const traceRef = useRef<HTMLDivElement>(null);
  const [ruleHeight, setRuleHeight] = useState(0);
  // The rule is drawn to the trace's measured height so it grows with the
  // rows instead of overshooting the last one.
  useLayoutEffect(() => {
    if (traceRef.current !== null) setRuleHeight(traceRef.current.offsetHeight);
  }, [rows, expanded]);

  return (
    <div className={cn("flex w-full flex-col", className)}>
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setManualExpanded(!expanded)}
        className="-mx-1.5 flex w-fit items-center gap-2 rounded-md px-1.5 py-1 transition-colors duration-100 hover:bg-hover"
      >
        <svg
          aria-hidden
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill={working ? "var(--ink-2)" : "var(--ink-3)"}
        >
          <path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z" />
        </svg>
        <span role="status" className="contents">
          {working ? (
            <span className="bui-shimmer-text text-[13px] font-medium whitespace-nowrap">
              {label}
            </span>
          ) : (
            <span className="animate-in fade-in text-[13px] font-medium whitespace-nowrap text-ink-2">
              {doneLabel}
            </span>
          )}
        </span>
        <svg
          aria-hidden
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--ink-3)"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={cn("transition-transform duration-300", expanded && "rotate-180")}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {/* 0fr → 1fr keeps the collapse animatable without measuring content. */}
      <div
        className="grid transition-[grid-template-rows,opacity] duration-300 ease-[cubic-bezier(0.23,1,0.32,1)]"
        style={{ gridTemplateRows: expanded ? "1fr" : "0fr", opacity: expanded ? 1 : 0 }}
      >
        <div className="overflow-hidden">
          <div className="relative mt-1 ml-[5px] pl-4">
            <span
              aria-hidden
              className="absolute left-[3px] w-px bg-line transition-[height] duration-500"
              style={{ top: -8, height: ruleHeight === 0 ? 0 : ruleHeight - 2 }}
            />
            <div ref={traceRef} className="flex flex-col gap-1 py-1">
              {rows.map((row, index) => {
                const entrance = {
                  animationDelay: `${String(Math.min(index, 6) * 120)}ms`,
                };
                if (row.onSelect === undefined) {
                  return (
                    <div
                      key={row.id}
                      className={cn(
                        ROW_CLASS,
                        "animate-in fade-in slide-in-from-bottom-1 fill-mode-both",
                      )}
                      style={entrance}
                    >
                      <RowBody row={row} />
                    </div>
                  );
                }
                return (
                  <button
                    key={row.id}
                    type="button"
                    aria-pressed={row.selected === true}
                    onClick={row.onSelect}
                    className={cn(
                      ROW_CLASS,
                      "animate-in fade-in slide-in-from-bottom-1 fill-mode-both transition-colors duration-150",
                      row.selected === true ? "bg-surface-inset" : "hover:bg-hover",
                    )}
                    style={entrance}
                  >
                    <RowBody row={row} />
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
