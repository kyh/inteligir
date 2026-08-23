"use client";
// Vendored from Beautiful UI (beautifului.dev), MIT.

import { forwardRef } from "react";
import type { HTMLAttributes, ReactNode } from "react";
import { cva } from "class-variance-authority";

import { cn } from "@repo/ui/lib/utils";

/* ─────────────────────────────────────────────────────────
 * RECOMMENDATION CARD — one suggestion, its confidence, and
 * the alternatives it beat
 *
 * Upstream holds three fixture options, promotes the picked one
 * and renders its own buttons. Here the CARD IS COMPOSED: the
 * recommendation, the drawer of alternatives and the footer are
 * children, and the actions are a SLOT the caller fills with its
 * own buttons — a card that shipped its own confirm control would
 * decide what confirming means.
 *
 * The confidence meter is monochrome. Upstream tints it green /
 * orange / grey; confidence is not a settled status, so this skin
 * says it with ink weight instead of inventing hues it lacks.
 * ───────────────────────────────────────────────────────── */

const meterBarVariants = cva("w-1 rounded-full transition-colors duration-300", {
  variants: {
    filled: {
      true: "",
      false: "bg-line-strong",
    },
    strength: {
      high: "",
      medium: "",
      none: "",
    },
  },
  compoundVariants: [
    { filled: true, strength: "high", class: "bg-ink" },
    { filled: true, strength: "medium", class: "bg-ink-2" },
    { filled: true, strength: "none", class: "bg-line-strong" },
  ],
  defaultVariants: { filled: false, strength: "medium" },
});

export interface ConfidenceMeterProps extends HTMLAttributes<HTMLSpanElement> {
  /** How many of the three bars are lit. */
  signal: 0 | 1 | 2 | 3;
  strength?: "high" | "medium" | "none";
}

const ConfidenceMeter = forwardRef<HTMLSpanElement, ConfidenceMeterProps>(
  ({ className, signal, strength = "medium", ...props }, ref) => (
    <span
      ref={ref}
      data-slot="confidence-meter"
      className={cn("flex items-end gap-0.5", className)}
      {...props}
    >
      {[0, 1, 2].map((bar) => (
        <span
          key={bar}
          className={meterBarVariants({ filled: bar < signal, strength })}
          style={{ height: 10 }}
        />
      ))}
    </span>
  ),
);
ConfidenceMeter.displayName = "ConfidenceMeter";

const RecommendationCard = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="recommendation-card"
      className={cn(
        "w-full overflow-hidden rounded-xl bg-surface-raised shadow-surface-2",
        className,
      )}
      {...props}
    />
  ),
);
RecommendationCard.displayName = "RecommendationCard";

export interface RecommendationCardHeaderProps extends HTMLAttributes<HTMLDivElement> {
  /** The recommendation itself, under the question. */
  body?: ReactNode;
}

const RecommendationCardHeader = forwardRef<HTMLDivElement, RecommendationCardHeaderProps>(
  ({ className, children, body, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="recommendation-card-header"
      className={cn("px-3.5 py-3", className)}
      {...props}
    >
      <span className="text-[14px] font-medium text-ink">{children}</span>
      {body === undefined ? null : (
        <p className="mt-1.5 text-[13px] leading-relaxed text-ink-2">{body}</p>
      )}
    </div>
  ),
);
RecommendationCardHeader.displayName = "RecommendationCardHeader";

export interface RecommendationAlternativesProps extends HTMLAttributes<HTMLDivElement> {
  open?: boolean;
  /** Small label above the list. */
  label?: ReactNode;
}

const RecommendationAlternatives = forwardRef<HTMLDivElement, RecommendationAlternativesProps>(
  ({ className, children, open = false, label = "Other options", ...props }, ref) => (
    <div
      className="grid transition-[grid-template-rows,opacity] duration-300 motion-reduce:transition-none"
      style={{
        gridTemplateRows: open ? "1fr" : "0fr",
        opacity: open ? 1 : 0,
        transitionTimingFunction: "cubic-bezier(0.16, 1, 0.3, 1)",
      }}
      aria-hidden={open ? undefined : true}
    >
      <div className="overflow-hidden">
        <div
          ref={ref}
          data-slot="recommendation-alternatives"
          className={cn("border-t border-line px-2 py-2", className)}
          {...props}
        >
          {label === undefined ? null : (
            <p className="px-1.5 pb-1 text-[11px] font-medium text-ink-3">{label}</p>
          )}
          {children}
        </div>
      </div>
    </div>
  ),
);
RecommendationAlternatives.displayName = "RecommendationAlternatives";

export interface RecommendationAlternativeProps extends HTMLAttributes<HTMLButtonElement> {
  /** Leading meter — same vocabulary as the card's own footer. */
  meter?: ReactNode;
  /** Trailing confidence wording. */
  note?: ReactNode;
}

const RecommendationAlternative = forwardRef<HTMLButtonElement, RecommendationAlternativeProps>(
  ({ className, children, meter, note, ...props }, ref) => (
    <button
      ref={ref}
      type="button"
      data-slot="recommendation-alternative"
      className={cn(
        "flex w-full items-center gap-2.5 rounded-lg px-1.5 py-1.5 text-left",
        "transition-colors duration-100 hover:bg-hover",
        className,
      )}
      {...props}
    >
      {meter}
      <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">{children}</span>
      {note === undefined ? null : <span className="shrink-0 text-[11px] text-ink-3">{note}</span>}
    </button>
  ),
);
RecommendationAlternative.displayName = "RecommendationAlternative";

export interface RecommendationCardFooterProps extends HTMLAttributes<HTMLDivElement> {
  /** The caller's own buttons — this card does not ship a confirm control. */
  actions?: ReactNode;
}

const RecommendationCardFooter = forwardRef<HTMLDivElement, RecommendationCardFooterProps>(
  ({ className, children, actions, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="recommendation-card-footer"
      className={cn(
        "flex items-center justify-between gap-3 border-t border-line px-3.5 py-2.5",
        className,
      )}
      {...props}
    >
      <span className="flex items-center gap-2 text-[12.5px] font-medium text-ink-2">
        {children}
      </span>
      {actions === undefined ? null : (
        <span className="-mr-0.5 flex items-center gap-2">{actions}</span>
      )}
    </div>
  ),
);
RecommendationCardFooter.displayName = "RecommendationCardFooter";

export {
  RecommendationCard,
  RecommendationCardHeader,
  RecommendationAlternatives,
  RecommendationAlternative,
  RecommendationCardFooter,
  ConfidenceMeter,
  meterBarVariants,
};
