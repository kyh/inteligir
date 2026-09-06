import type { DataDirScope } from "@repo/api/local/system/system-schema";
import { toast } from "@repo/ui/components/sonner";
import { cn } from "cn";
import { refusalMessage } from "../api";

export function failed(cause: unknown, fallback: string): void {
  toast.error(refusalMessage(cause, fallback));
}

// The credential, the connectors and the agent default live in the data dir, and a second
// vault has one of its own: one sentence, wherever a surface would otherwise look reset.
export function SecondVaultNote({ scope }: { scope: DataDirScope | undefined }) {
  if (scope !== "vault") {
    return null;
  }
  return (
    <p className="text-xs text-muted-foreground">
      This is a second vault with a data dir of its own: its sign-in, connectors and default agent
      start empty and stay with it.
    </p>
  );
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
