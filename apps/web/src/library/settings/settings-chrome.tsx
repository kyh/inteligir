import { RadioGroup, RadioGroupItem } from "@repo/ui/components/radio-group";

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
