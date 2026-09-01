// The bits every settings section is built out of: the label/value row, the
// section heading, the one-of-N control, and the way a section reports a
// refusal. Their own module because more than one file draws a section — and
// a second copy of the radiogroup would be a second
// answer to which element carries `aria-checked`, which is the kind of
// divergence only a screen reader notices.

import { toast } from "@repo/ui/components/sonner";
import { cn } from "@repo/ui/lib/utils";
import { refusalMessage } from "../api";

/** `refusalMessage`, toasted — the sections' one way of saying a verb failed. */
export function failed(cause: unknown, fallback: string): void {
  toast.error(refusalMessage(cause, fallback));
}

export function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[7rem_1fr] items-baseline gap-x-4 gap-y-1 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

export function SectionHeading({ children }: { children: React.ReactNode }) {
  return <h3 className="text-xs font-medium tracking-wide text-muted-foreground">{children}</h3>;
}

export function ChoiceRow<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (next: T) => void;
}) {
  return (
    <div className="flex gap-1" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          className={cn(
            "rounded-md border px-3 py-1 text-sm",
            value === option.value
              ? "border-ring bg-muted text-foreground"
              : "border-border text-muted-foreground hover:bg-muted/50",
          )}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
