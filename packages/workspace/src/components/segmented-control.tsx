import type { ReactNode } from "react";

import { cn } from "@repo/ui/lib/utils";

// Segmented control on a sunken track — the selected segment lifts to a
// card pill (the refs' Objects/Prompts switcher). One recipe for every
// consumer (settings-panel Appearance, custom-connector kind picker); pass
// grid columns via className and per-segment layout via optionClassName.
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  className,
  optionClassName,
}: {
  options: readonly { value: T; label: ReactNode }[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
  optionClassName?: string;
}) {
  return (
    <div className={cn("grid gap-1 rounded-[12px] bg-muted p-1", className)}>
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          aria-pressed={value === opt.value}
          className={cn(
            "rounded-[8px] px-2 py-1.5 transition-colors",
            value === opt.value
              ? "bg-card text-foreground shadow-surface-2"
              : "text-muted-foreground hover:bg-hover hover:text-foreground",
            optionClassName,
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
