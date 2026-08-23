"use client";
// Vendored from Beautiful UI (beautifului.dev), MIT.

import { useState, type ReactNode } from "react";

import { cn } from "@repo/ui/lib/utils";

/* ─────────────────────────────────────────────────────────
 * TASK ROWS — live status for a list of agent tasks
 *
 * A badge carries the state (numbered ring while working, a
 * check or cross once settled), the row carries the label and
 * a count, and each row expands to its own detail lines.
 *
 * Upstream walks a fixture through a canned tick sequence and
 * hardcodes its own status vocabulary. Here ROWS ARE THE INPUT
 * and `status` is the whole vocabulary, so the caller's own
 * lifecycle names map onto four visual states and stay the
 * source of truth. The status PILL is a slot for the same
 * reason: its wording belongs to the caller, not to this card.
 * ───────────────────────────────────────────────────────── */

export type TaskStatus = "pending" | "running" | "done" | "failed";

export interface TaskDetail {
  label: string;
  /** Right-aligned mono figure — "12/12", "68%". */
  meta?: string;
}

export interface TaskRow {
  id: string;
  status: TaskStatus;
  label: string;
  /** Secondary figure on the row — "7 SKUs", "2 messages". */
  amount?: string;
  /** The caller's own status wording; nothing is rendered without it. */
  pill?: ReactNode;
  details?: readonly TaskDetail[];
}

function SpinnerRing({ active, children }: { active: boolean; children: ReactNode }) {
  const size = 24;
  const stroke = 2;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  return (
    <span
      className="relative inline-flex shrink-0 items-center justify-center"
      style={{ width: size, height: size }}
    >
      <svg
        aria-hidden
        width={size}
        height={size}
        className={cn("absolute inset-0", active && "animate-spin")}
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--line)"
          strokeWidth={stroke}
        />
        {active ? (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="var(--ink-3)"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${String(circumference * 0.28)} ${String(circumference * 0.72)}`}
          />
        ) : null}
      </svg>
      <span className="relative text-[10.5px] font-semibold tabular-nums text-ink">{children}</span>
    </span>
  );
}

const CHECK_ICON = (
  <svg
    aria-hidden
    width="13"
    height="13"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="3.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M20 6L9 17l-5-5" />
  </svg>
);

const X_ICON = (
  <svg
    aria-hidden
    width="12"
    height="12"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="3.5"
    strokeLinecap="round"
  >
    <path d="M18 6L6 18M6 6l12 12" />
  </svg>
);

/** The row's one splash of hue: settled states read at a glance in a list that
 *  is otherwise monochrome. `text-white` on the done fill is a contrast
 *  requirement — the palette has no success-foreground token to reach for. */
function StatusBadge({ status, ordinal }: { status: TaskStatus; ordinal: number }) {
  if (status === "done") {
    return (
      <span className="flex size-5.5 shrink-0 animate-in items-center justify-center rounded-full bg-emerald-500 text-white zoom-in-95">
        {CHECK_ICON}
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span className="flex size-5.5 shrink-0 animate-in items-center justify-center rounded-full bg-destructive text-destructive-foreground zoom-in-95">
        {X_ICON}
      </span>
    );
  }
  return <SpinnerRing active={status === "running"}>{ordinal}</SpinnerRing>;
}

export interface TaskRowsProps {
  rows: readonly TaskRow[];
  /** `capsules` floats each row on its own card; `list` is one bordered stack. */
  variant?: "capsules" | "list";
  className?: string;
}

export function TaskRows({ rows, variant = "capsules", className }: TaskRowsProps) {
  const [openRows, setOpenRows] = useState<ReadonlySet<string>>(new Set());
  const list = variant === "list";

  const toggle = (id: string): void => {
    const next = new Set(openRows);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setOpenRows(next);
  };

  return (
    <div
      className={cn(
        "flex w-full flex-col",
        list ? "gap-0 overflow-hidden rounded-xl bg-surface-raised shadow-surface-2" : "gap-2",
        className,
      )}
    >
      {rows.map((row, index) => {
        const open = openRows.has(row.id);
        const expandable = row.details !== undefined && row.details.length > 0;
        return (
          <div
            key={row.id}
            className={cn(
              "animate-in fade-in slide-in-from-bottom-1 fill-mode-both self-stretch overflow-hidden transition-[border-radius,background-color] duration-300",
              list
                ? "border-b border-line last:border-0"
                : "rounded-[22px] bg-surface-raised shadow-surface-2 hover:bg-surface-inset",
              !list && open && "rounded-[14px]",
            )}
            style={{ animationDelay: `${String(Math.min(index, 6) * 80)}ms` }}
          >
            <button
              type="button"
              aria-expanded={expandable ? open : undefined}
              disabled={!expandable}
              onClick={() => toggle(row.id)}
              className="flex h-11 w-full items-center gap-2.5 px-2.5 text-left"
            >
              <span className="flex size-6 shrink-0 items-center justify-center">
                <StatusBadge status={row.status} ordinal={index + 1} />
              </span>
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">
                {row.label}
              </span>
              {row.amount !== undefined ? (
                <span className="shrink-0 text-[12.5px] text-ink-2 tabular-nums">{row.amount}</span>
              ) : null}
              {row.pill}
              {expandable ? (
                <span
                  aria-hidden
                  className="-ml-2 flex size-7 shrink-0 items-center justify-center rounded-full text-ink-3"
                >
                  <svg
                    width="15"
                    height="15"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className={cn("transition-transform duration-300", open && "rotate-180")}
                  >
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </span>
              ) : null}
            </button>

            {expandable ? (
              <div
                className="grid transition-[grid-template-rows,opacity] duration-300 ease-[cubic-bezier(0.23,1,0.32,1)]"
                style={{ gridTemplateRows: open ? "1fr" : "0fr", opacity: open ? 1 : 0 }}
              >
                <div className="overflow-hidden">
                  <div className="mb-2.5 grid grid-cols-[24px_1fr] gap-2.5 px-2.5">
                    <span aria-hidden className="mx-auto h-full w-px bg-line" />
                    <div className="flex flex-col gap-1.5">
                      {(row.details ?? []).map((detail) => (
                        <div key={detail.label} className="flex items-center justify-between gap-2">
                          <span className="min-w-0 text-[12px] text-ink-2">{detail.label}</span>
                          {detail.meta !== undefined ? (
                            <span className="shrink-0 font-mono text-[11.5px] text-ink-3 tabular-nums">
                              {detail.meta}
                            </span>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
