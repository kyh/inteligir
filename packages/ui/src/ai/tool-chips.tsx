"use client";
// Vendored from Beautiful UI (beautifului.dev), MIT.

import { useState, type ReactNode } from "react";

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

export type ToolIcon = "think" | "write" | "run" | "read";

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

export interface ToolDetailLine {
  text: string;
  /** An added line renders in the diff-add ink. */
  tone?: "add";
}

export interface ToolChipRow {
  id: string;
  icon: ToolIcon;
  /** "Write 204 lines", "Rebuild and verify". */
  label: string;
  /** The call's target — a path, a command, a one-line summary. */
  chip: string;
  /** Render the chip in the mono face (paths, commands). */
  mono?: boolean;
  /** Render the detail lines in the mono face. */
  detailMono?: boolean;
  detail?: readonly ToolDetailLine[];
}

export interface ToolChipsProps {
  rows: readonly ToolChipRow[];
  /** The run header — "4 tool calls, 2 messages". */
  summary: string;
  defaultExpanded?: boolean;
  className?: string;
}

export function ToolChips({ rows, summary, defaultExpanded = true, className }: ToolChipsProps) {
  const [open, setOpen] = useState(defaultExpanded);
  const [openRows, setOpenRows] = useState<ReadonlySet<string>>(new Set());

  const toggleRow = (id: string): void => {
    const next = new Set(openRows);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setOpenRows(next);
  };

  return (
    <div className={cn("w-full pb-1", className)}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
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

      <div
        className="grid transition-[grid-template-rows,opacity] duration-300"
        style={{ gridTemplateRows: open ? "1fr" : "0fr", opacity: open ? 1 : 0 }}
      >
        {/* -mx-1 + px-1.5 keeps content at the same x while giving the row
            hover pills room inside this overflow-hidden clip box. */}
        <div className="-mx-1 overflow-hidden px-1.5 pb-1">
          <div className="mt-1.5 flex flex-col gap-1">
            {rows.map((row) => {
              const rowOpen = openRows.has(row.id);
              const expandable = row.detail !== undefined && row.detail.length > 0;
              return (
                <div key={row.id} className="animate-in fade-in slide-in-from-bottom-1">
                  <button
                    type="button"
                    aria-expanded={expandable ? rowOpen : undefined}
                    disabled={!expandable}
                    onClick={() => toggleRow(row.id)}
                    className="group/row -mx-[3px] flex h-7 w-[calc(100%+6px)] min-w-0 items-center gap-2 rounded-md px-[3px] text-left transition-colors duration-100 enabled:hover:bg-hover"
                  >
                    <span className="relative flex size-4 shrink-0 items-center justify-center text-ink-3">
                      <svg
                        aria-hidden
                        width="13"
                        height="13"
                        viewBox="0 0 24 24"
                        fill={row.icon === "think" ? "currentColor" : "none"}
                        stroke="currentColor"
                        className={cn(
                          "transition-opacity duration-100",
                          expandable && "group-hover/row:opacity-0",
                          rowOpen && "opacity-0",
                        )}
                      >
                        {ICONS[row.icon]}
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
                            rowOpen ? "rotate-0 opacity-100" : "-rotate-90 opacity-0",
                          )}
                        >
                          <path d="M6 9l6 6 6-6" />
                        </svg>
                      ) : null}
                    </span>
                    <span className="shrink-0 text-[12.5px] font-medium text-ink">{row.label}</span>
                    <span
                      className={cn(
                        "inline-flex h-5.5 min-w-0 flex-1 items-center truncate rounded-md bg-muted px-1.5 text-[11.5px] text-ink-2",
                        row.mono === true && "font-mono",
                      )}
                    >
                      {row.chip}
                    </span>
                  </button>

                  {expandable ? (
                    <div
                      className="grid transition-[grid-template-rows,opacity] duration-300 ease-[cubic-bezier(0.23,1,0.32,1)]"
                      style={{
                        gridTemplateRows: rowOpen ? "1fr" : "0fr",
                        opacity: rowOpen ? 1 : 0,
                      }}
                    >
                      <div className="min-h-0 overflow-hidden">
                        <div className="mt-0.5 mb-1 ml-2 flex flex-col gap-0.5 border-l border-line py-0.5 pl-3.5">
                          {(row.detail ?? []).map((line, index) => (
                            <span
                              key={`${row.id}:${String(index)}`}
                              className={cn(
                                "truncate text-[11.5px] leading-[1.6]",
                                row.detailMono === true && "font-mono",
                                line.tone === "add" ? "text-emerald-500" : "text-ink-2",
                              )}
                            >
                              {line.text}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
