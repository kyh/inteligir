import { RadioGroup, RadioGroupItem } from "@repo/ui/components/radio-group";
import { toast } from "@repo/ui/components/sonner";

// the shell answers a refusal as a value, so a rejected command is a fault, worded for the
// shell's log rather than for the person: the row says its own sentence instead
export const bridgeFailed = (cause: unknown, sentence: string): void => {
  console.warn("[desktop] the shell did not answer", cause);
  toast.error(sentence);
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
