"use client";
// Vendored from Beautiful UI (beautifului.dev), MIT.

import { useLayoutEffect, useState } from "react";
import type { HTMLAttributes, RefAttributes } from "react";
import { ChevronDownIcon } from "lucide-react";

import { Collapse } from "@repo/ui/lib/collapse";
import { cn } from "@repo/ui/lib/cn";

interface ThinkingProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  label?: string;
  doneLabel: string;
  working?: boolean;
}

const Thinking = ({
  label = "Thinking",
  doneLabel,
  working = false,
  className,
  children,
  ref,
  ...props
}: ThinkingProps & RefAttributes<HTMLDivElement>) => {
  const [expanded, setExpanded] = useState(false);
  const [traceEl, setTraceEl] = useState<HTMLDivElement | null>(null);
  const [ruleHeight, setRuleHeight] = useState(0);
  // observed rather than measured per render: the trace reflows (wrapping, fonts) with no render of this component
  useLayoutEffect(() => {
    if (traceEl === null) {
      return;
    }
    const ro = new ResizeObserver(() => {
      setRuleHeight(traceEl.offsetHeight);
    });
    ro.observe(traceEl);
    return () => {
      ro.disconnect();
    };
  }, [traceEl]);

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
        onClick={() => {
          setExpanded(!expanded);
        }}
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
        <output className="contents">
          {working ? (
            <span className="bui-shimmer-text text-subtitle font-medium whitespace-nowrap">
              {label}
            </span>
          ) : (
            <span className="animate-in fade-in text-subtitle font-medium whitespace-nowrap text-ink-2">
              {doneLabel}
            </span>
          )}
        </output>
        <ChevronDownIcon
          size={14}
          strokeWidth={2.2}
          className={cn("text-ink-3 transition-transform duration-300", expanded && "rotate-180")}
        />
      </button>

      <Collapse open={expanded}>
        <div className="relative mt-1 ml-[5px] pl-4">
          <span
            aria-hidden
            className="absolute left-[3px] w-px bg-line transition-[height] duration-500"
            style={{ height: ruleHeight === 0 ? 0 : ruleHeight - 2, top: -8 }}
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
};

const ThinkingReasoning = ({
  className,
  children,
  ref,
  ...props
}: HTMLAttributes<HTMLDivElement> & RefAttributes<HTMLDivElement>) => (
  <div
    ref={ref}
    data-slot="thinking-reasoning"
    className={cn(
      "flex min-h-7 w-full items-center gap-2 rounded-[6px] px-1.5 py-0.5 text-left animate-in fade-in slide-in-from-bottom-1 fill-mode-both",
      className,
    )}
    {...props}
  >
    <span className="min-w-0 truncate text-body leading-relaxed whitespace-normal text-ink-2">
      {children}
    </span>
  </div>
);

export { Thinking, ThinkingReasoning };
