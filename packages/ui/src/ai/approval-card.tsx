"use client";
// Vendored from Beautiful UI (beautifului.dev), MIT.

import type { HTMLAttributes, RefAttributes } from "react";

import { cn } from "@repo/ui/lib/cn";

interface ApprovalCardProps<Value extends string> extends HTMLAttributes<HTMLDivElement> {
  prompt: string;
  detail: string | null;
  options: readonly { readonly value: Value; readonly label: string }[];
  // the option whose answer is on its way or has landed: it reads pressed and every option is
  // held, since whoever sends the answer knows whether it went, and the card does not
  picked: Value | null;
  onPick: (value: Value) => void;
}

const ApprovalCard = <Value extends string>({
  prompt,
  detail,
  options,
  picked,
  onPick,
  className,
  ref,
  ...props
}: ApprovalCardProps<Value> & RefAttributes<HTMLDivElement>) => (
  <div
    ref={ref}
    data-slot="approval-card"
    aria-busy={picked !== null}
    className={cn(
      "w-full overflow-hidden rounded-xl bg-surface-raised shadow-surface-2",
      className,
    )}
    {...props}
  >
    <div className="animate-in fade-in slide-in-from-bottom-1 p-3">
      <span className="flex min-w-0 flex-col gap-1">
        <span className="text-subtitle font-medium text-ink">{prompt}</span>
        {detail === null ? null : (
          <span className="text-body break-words text-ink-2">{detail}</span>
        )}
      </span>
      <div className="mt-2 flex flex-col gap-0.5">
        {options.map(({ label, value }) => {
          const on = value === picked;
          return (
            <button
              key={value}
              type="button"
              aria-pressed={on}
              disabled={picked !== null}
              onClick={() => {
                onPick(value);
              }}
              data-slot="approval-option"
              className="-mx-1.5 flex items-center gap-2 rounded-md px-1.5 py-1 text-left transition-colors duration-100 enabled:hover:bg-hover"
            >
              <span
                className={cn(
                  "flex size-4 shrink-0 items-center justify-center rounded-full transition-colors duration-200",
                  on
                    ? "bg-ink text-background"
                    : "text-transparent shadow-[inset_0_0_0_1.5px_var(--line-strong)]",
                )}
              >
                <span
                  className={cn(
                    "size-1.5 rounded-full bg-background transition-transform duration-200",
                    on ? "scale-100" : "scale-0",
                  )}
                />
              </span>
              <span
                className={cn(
                  "text-subtitle transition-colors duration-200",
                  on ? "text-ink" : "text-ink-2",
                )}
              >
                {label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  </div>
);

export { ApprovalCard };
