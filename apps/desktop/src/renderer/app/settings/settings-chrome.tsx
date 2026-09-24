import type { DataDirScope } from "@repo/api/local/system/system-schema";
import { RadioGroup, RadioGroupItem } from "@repo/ui/components/radio-group";
import { toast } from "@repo/ui/components/sonner";

// main answers a refusal as a value, so a throw across the bridge is a fault, and Electron
// wraps its message in words of its own: the row says its own sentence instead
export const bridgeFailed = (cause: unknown, sentence: string): void => {
  console.warn("[desktop] the shell did not answer", cause);
  toast.error(sentence);
};

// The credential, the connectors and the agent default live in the data dir, and a second
// vault has one of its own: one sentence, wherever a surface would otherwise look reset.
export const SecondVaultNote = ({ scope }: { scope: DataDirScope | undefined }) => {
  if (scope !== "vault") {
    return null;
  }
  return (
    <p className="text-body text-muted-foreground">
      This is a second vault with a data dir of its own: its sign-in, connectors and default agent
      start empty and stay with it.
    </p>
  );
};

export const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="grid grid-cols-[7rem_1fr] items-baseline gap-x-4 gap-y-1 text-subtitle">
    <dt className="text-muted-foreground">{label}</dt>
    <dd className="min-w-0">{children}</dd>
  </div>
);

export const SectionHeading = ({ children }: { children: React.ReactNode }) => (
  <h3 className="text-body font-medium tracking-wide text-muted-foreground">{children}</h3>
);

export const ChoiceRow = <T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (next: T) => void;
}) => (
  <RadioGroup aria-label={label} value={value} onValueChange={onChange}>
    {options.map((option) => (
      <RadioGroupItem key={option.value} value={option.value}>
        {option.label}
      </RadioGroupItem>
    ))}
  </RadioGroup>
);
