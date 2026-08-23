"use client";
// Vendored from Beautiful UI (beautifului.dev), MIT.

import { forwardRef, useRef } from "react";
import type { HTMLAttributes, KeyboardEvent, PointerEvent, ReactNode } from "react";

import { cn } from "@repo/ui/lib/utils";
import { GlideList } from "@repo/ui/ai/glide-list";

/* ─────────────────────────────────────────────────────────
 * FINE-TUNE CARD — numeric controls an agent's output is
 * adjusted through
 *
 * The piece worth carrying is the SCRUB FIELD: a label you drag
 * sideways to change the number, which also accepts typing and
 * arrow keys. Upstream owns a fixture of settings; here every
 * field is controlled by the caller.
 *
 * The card's menu uses `glide-list.tsx` — upstream composes an
 * internal `GlideMenu` its payload does not include.
 * ───────────────────────────────────────────────────────── */

const FineTuneCard = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="fine-tune-card"
      className={cn(
        "w-full overflow-hidden rounded-xl bg-surface-raised shadow-surface-2",
        className,
      )}
      {...props}
    />
  ),
);
FineTuneCard.displayName = "FineTuneCard";

export interface FineTuneSectionProps extends HTMLAttributes<HTMLDivElement> {
  label?: ReactNode;
}

const FineTuneSection = forwardRef<HTMLDivElement, FineTuneSectionProps>(
  ({ className, children, label, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="fine-tune-section"
      className={cn("border-b border-line px-3 py-2.5 last:border-0", className)}
      {...props}
    >
      {label === undefined ? null : (
        <p className="pb-1.5 text-[11px] font-medium text-ink-3">{label}</p>
      )}
      <div className="flex flex-wrap items-center gap-1.5">{children}</div>
    </div>
  ),
);
FineTuneSection.displayName = "FineTuneSection";

export interface ScrubFieldProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  /** How much one pixel of drag is worth, and the arrow-key increment. */
  step?: number;
  /** Unit shown after the number. */
  suffix?: string;
  /** Highlights the field as the one currently driving something. */
  active?: boolean;
  className?: string;
}

/** Drag the LABEL to scrub; type in the field; arrows step (shift ×10). */
function ScrubField({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  suffix,
  active = false,
  className,
}: ScrubFieldProps) {
  const drag = useRef<{ x: number; value: number } | null>(null);
  const clamp = (next: number) => Math.min(max, Math.max(min, Math.round(next)));

  const onPointerDown = (event: PointerEvent<HTMLSpanElement>) => {
    // Narrowed rather than asserted: the repo bans type assertions, and a
    // pointer target genuinely might not be an element.
    if (event.target instanceof HTMLElement) event.target.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, value };
  };

  const onPointerMove = (event: PointerEvent<HTMLSpanElement>) => {
    const start = drag.current;
    if (start === null) return;
    onChange(clamp(start.value + ((event.clientX - start.x) / 2) * step));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLSpanElement>) => {
    const multiplier = event.shiftKey ? 10 : 1;
    if (event.key === "ArrowUp" || event.key === "ArrowRight") {
      event.preventDefault();
      onChange(clamp(value + step * multiplier));
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowLeft") {
      event.preventDefault();
      onChange(clamp(value - step * multiplier));
    }
  };

  return (
    <label
      data-slot="scrub-field"
      data-active={active ? "" : undefined}
      className={cn(
        "flex h-6.5 min-w-0 items-center gap-1 rounded-full py-1 pr-1 pl-0.5",
        "bg-surface-inset transition-[background-color,box-shadow] duration-200",
        active && "ring-1 ring-[color:var(--focus-ring)]",
        className,
      )}
    >
      <span
        role="slider"
        aria-label={label}
        aria-valuenow={value}
        aria-valuemin={min}
        aria-valuemax={max}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={() => (drag.current = null)}
        onKeyDown={onKeyDown}
        className={cn(
          "flex h-full shrink-0 cursor-ew-resize touch-none items-center rounded-[4px] px-0.5",
          "text-[12px] text-ink-3 select-none hover:text-ink-2 focus-visible:text-ink",
          "focus-visible:outline-none",
        )}
      >
        {label}
      </span>
      <input
        inputMode="numeric"
        value={value}
        aria-label={`${label} value`}
        onChange={(event) => {
          const next = Number(event.target.value.replace(/[^\d-]/gu, ""));
          if (!Number.isNaN(next)) onChange(clamp(next));
        }}
        className="min-w-0 flex-1 bg-transparent text-[12px] text-ink tabular-nums outline-none"
      />
      {suffix === undefined ? null : (
        <span className="shrink-0 pr-0.5 text-[11.5px] text-ink-3">{suffix}</span>
      )}
    </label>
  );
}

export interface SegmentGroupProps extends HTMLAttributes<HTMLDivElement> {
  label?: string;
}

const SegmentGroup = forwardRef<HTMLDivElement, SegmentGroupProps>(
  ({ className, label, ...props }, ref) => (
    <div
      ref={ref}
      role="group"
      aria-label={label}
      data-slot="segment-group"
      className={cn("flex items-center gap-px rounded-lg bg-surface-inset p-0.5", className)}
      {...props}
    />
  ),
);
SegmentGroup.displayName = "SegmentGroup";

export interface SegmentOptionProps extends HTMLAttributes<HTMLButtonElement> {
  active?: boolean;
}

const SegmentOption = forwardRef<HTMLButtonElement, SegmentOptionProps>(
  ({ className, active = false, ...props }, ref) => (
    <button
      ref={ref}
      type="button"
      aria-pressed={active}
      data-slot="segment-option"
      className={cn(
        "flex h-5.5 items-center rounded-md px-1.5 text-[11.5px] font-medium transition-colors duration-100",
        active ? "bg-surface-raised text-ink shadow-surface-1" : "text-ink-3 hover:text-ink-2",
        className,
      )}
      {...props}
    />
  ),
);
SegmentOption.displayName = "SegmentOption";

const FineTuneMenu = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, children, ...props }, ref) => (
    <div ref={ref} data-slot="fine-tune-menu" className={cn("p-1", className)} {...props}>
      <GlideList className="flex flex-col gap-px" highlightClassName="inset-x-0 rounded-md">
        {children}
      </GlideList>
    </div>
  ),
);
FineTuneMenu.displayName = "FineTuneMenu";

export interface FineTuneMenuItemProps extends HTMLAttributes<HTMLButtonElement> {
  /** Trailing value or shortcut. */
  meta?: ReactNode;
}

const FineTuneMenuItem = forwardRef<HTMLButtonElement, FineTuneMenuItemProps>(
  ({ className, children, meta, ...props }, ref) => (
    <button
      ref={ref}
      type="button"
      data-menu-row
      data-slot="fine-tune-menu-item"
      className={cn(
        "relative z-10 flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] text-ink",
        "outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--focus-ring)]",
        className,
      )}
      {...props}
    >
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {meta === undefined ? null : (
        <span className="shrink-0 text-[11.5px] text-ink-3 tabular-nums">{meta}</span>
      )}
    </button>
  ),
);
FineTuneMenuItem.displayName = "FineTuneMenuItem";

export {
  FineTuneCard,
  FineTuneSection,
  ScrubField,
  SegmentGroup,
  SegmentOption,
  FineTuneMenu,
  FineTuneMenuItem,
};
