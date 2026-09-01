"use client";
// Vendored from Beautiful UI (beautifului.dev), MIT.

import { forwardRef, useLayoutEffect, useState, type HTMLAttributes, type ReactNode } from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { Collapse } from "@repo/ui/lib/collapse";
import { composeRefs } from "@repo/ui/lib/compose-refs";
import { cn } from "@repo/ui/lib/utils";

/* ─────────────────────────────────────────────────────────
 * THINKING — a collapsible trace of what the agent did
 *
 * Header shimmers while working and settles to a summary;
 * the trace hangs off a vertical rule, one row per step.
 *
 * The ROWS ARE CHILDREN and each part names its own kind,
 * because a real turn interleaves reasoning and tool calls in
 * one trace. There is no Search variant: it renders web
 * sources this product has none of.
 * ───────────────────────────────────────────────────────── */

interface ThinkingProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  /** Shown, shimmering, while `working`. */
  label?: string;
  /** Shown once settled — "Thought for 4s", "Ran 3 tools". */
  doneLabel: string;
  working?: boolean;
  /** Open on first render; the reader's own toggle wins afterwards. */
  defaultExpanded?: boolean;
}

const Thinking = forwardRef<HTMLDivElement, ThinkingProps>(
  (
    {
      label = "Thinking",
      doneLabel,
      working = false,
      defaultExpanded = false,
      className,
      children,
      ...props
    },
    ref,
  ) => {
    const [manualExpanded, setManualExpanded] = useState<boolean | null>(null);
    const expanded = manualExpanded ?? defaultExpanded;
    const [traceEl, setTraceEl] = useState<HTMLDivElement | null>(null);
    const [ruleHeight, setRuleHeight] = useState(0);
    // The rule is drawn to the trace's measured height so it grows with the
    // rows instead of overshooting the last one. Observed rather than measured
    // per render: the rows are children the caller streams in, and the trace
    // also reflows on its own (a row's text wrapping, a font landing) with no
    // render of this component to hang a measurement on.
    useLayoutEffect(() => {
      if (traceEl === null) return;
      const ro = new ResizeObserver(() => setRuleHeight(traceEl.offsetHeight));
      ro.observe(traceEl);
      return () => ro.disconnect();
    }, [traceEl]);

    // The entrance stagger is CSS rather than a per-row index, so rows stay
    // ordinary children the caller composes.
    return (
      <div
        ref={ref}
        data-slot="thinking"
        className={cn("flex w-full flex-col", className)}
        {...props}
      >
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setManualExpanded(!expanded)}
          data-slot="thinking-trigger"
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

        <Collapse open={expanded}>
          <div className="relative mt-1 ml-[5px] pl-4">
            <span
              aria-hidden
              className="absolute left-[3px] w-px bg-line transition-[height] duration-500"
              style={{ top: -8, height: ruleHeight === 0 ? 0 : ruleHeight - 2 }}
            />
            <div
              ref={setTraceEl}
              data-slot="thinking-trace"
              className="flex flex-col gap-1 py-1 [&>*:nth-child(2)]:[animation-delay:120ms] [&>*:nth-child(3)]:[animation-delay:240ms] [&>*:nth-child(4)]:[animation-delay:360ms] [&>*:nth-child(5)]:[animation-delay:480ms] [&>*:nth-child(n+6)]:[animation-delay:600ms]"
            >
              {children}
            </div>
          </div>
        </Collapse>
      </div>
    );
  },
);
Thinking.displayName = "Thinking";

const thinkingRowVariants = cva(
  "flex min-h-7 w-full items-center gap-2 rounded-[6px] px-1.5 py-0.5 text-left animate-in fade-in slide-in-from-bottom-1 fill-mode-both",
  {
    variants: {
      kind: {
        step: "",
        reasoning: "",
        tool: "",
      },
      selectable: {
        true: "transition-colors duration-150",
        false: "",
      },
    },
    defaultVariants: { kind: "step", selectable: false },
  },
);

interface ThinkingRowProps
  // HTMLElement rather than HTMLDivElement: a selectable row renders a
  // <button>, and the props and ref must fit whichever element the row is.
  extends Omit<HTMLAttributes<HTMLElement>, "onSelect">, VariantProps<typeof thinkingRowVariants> {
  /** A path, a count, a target — shown dimmed after the row's own text. */
  secondary?: ReactNode;
  /** Render `secondary` in the mono face (paths, commands). */
  mono?: boolean;
  /** Diff counts for an edit row. */
  added?: number;
  removed?: number;
  /** A row still in flight draws the spinner instead of the check. */
  pending?: boolean;
  onSelect?: () => void;
  selected?: boolean;
}

function RowIcon({ kind, pending }: { kind: "step" | "reasoning" | "tool"; pending: boolean }) {
  if (kind === "reasoning") return null;
  if (pending) {
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

/** The shared row body. `ThinkingStep`, `ThinkingReasoning` and `ThinkingTool`
 *  are this with their kind fixed, which is what makes the trace read as
 *  markup instead of as a discriminated array. */
const ThinkingRow = forwardRef<HTMLElement, ThinkingRowProps>(
  (
    {
      kind = "step",
      secondary,
      mono = false,
      added,
      removed,
      pending = false,
      onSelect,
      selected = false,
      className,
      children,
      ...props
    },
    ref,
  ) => {
    const rowKind = kind ?? "step";
    const body = (
      <>
        <RowIcon kind={rowKind} pending={pending} />
        <span
          className={cn(
            "min-w-0 truncate text-[12.5px]",
            rowKind === "reasoning"
              ? "whitespace-normal leading-relaxed text-ink-2"
              : "font-medium text-ink",
          )}
        >
          {children}
        </span>
        {secondary === undefined ? null : (
          <span className={cn("shrink-0 text-[11.5px] text-ink-3", mono && "font-mono")}>
            {secondary}
          </span>
        )}
        {added === undefined && removed === undefined ? null : (
          <span className="shrink-0 font-mono text-[11px] tabular-nums">
            <span className="text-emerald-500">+{added ?? 0}</span>{" "}
            <span className="text-destructive">−{removed ?? 0}</span>
          </span>
        )}
      </>
    );

    if (onSelect === undefined) {
      return (
        <div
          ref={composeRefs(ref)}
          data-slot={`thinking-${rowKind}`}
          className={cn(thinkingRowVariants({ kind: rowKind, selectable: false }), className)}
          {...props}
        >
          {body}
        </div>
      );
    }
    return (
      <button
        ref={composeRefs(ref)}
        type="button"
        aria-pressed={selected}
        onClick={onSelect}
        data-slot={`thinking-${rowKind}`}
        className={cn(
          thinkingRowVariants({ kind: rowKind, selectable: true }),
          selected ? "bg-surface-inset" : "hover:bg-hover",
          className,
        )}
        {...props}
      >
        {body}
      </button>
    );
  },
);
ThinkingRow.displayName = "ThinkingRow";

type ThinkingPartProps = Omit<ThinkingRowProps, "kind">;

const ThinkingStep = forwardRef<HTMLElement, ThinkingPartProps>((props, ref) => (
  <ThinkingRow ref={ref} kind="step" {...props} />
));
ThinkingStep.displayName = "ThinkingStep";

const ThinkingReasoning = forwardRef<HTMLElement, ThinkingPartProps>((props, ref) => (
  <ThinkingRow ref={ref} kind="reasoning" {...props} />
));
ThinkingReasoning.displayName = "ThinkingReasoning";

const ThinkingTool = forwardRef<HTMLElement, ThinkingPartProps>((props, ref) => (
  <ThinkingRow ref={ref} kind="tool" {...props} />
));
ThinkingTool.displayName = "ThinkingTool";

export { Thinking, ThinkingStep, ThinkingReasoning, ThinkingTool };
