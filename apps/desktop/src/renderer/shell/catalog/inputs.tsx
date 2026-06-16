// Interactive form inputs for the widget catalog. Each binds two-way to a
// state path via useBoundValue (the bind + emit are centralized in shared.tsx;
// value extraction stays at each call site so the bound type is explicit).

import { Button } from "@repo/ui/components/button";
import { Checkbox } from "@repo/ui/components/checkbox";
import { Input as UiInput } from "@repo/ui/components/input";
import { RadioGroup, RadioGroupItem } from "@repo/ui/components/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/components/select";
import { Slider, type SliderValue } from "@repo/ui/components/slider";
import { Switch } from "@repo/ui/components/switch";

import {
  FieldLabel,
  LabelDescription,
  useBoundValue,
  type BaseProps,
  type CatalogOption,
} from "@/renderer/shell/catalog/shared";

export function CatalogButton({
  props,
  emit,
}: BaseProps<{
  label: string;
  variant?: "default" | "outline" | "ghost" | "secondary" | "destructive";
  size?: "xs" | "sm" | "default" | "lg";
  disabled?: boolean;
}>) {
  return (
    <Button
      variant={props.variant ?? "ghost"}
      size={props.size ?? "sm"}
      disabled={props.disabled === true}
      onClick={() => emit("press")}
    >
      {props.label}
    </Button>
  );
}

export function CatalogCheckbox({
  props,
  emit,
  bindings,
}: BaseProps<{
  label: string;
  description?: string;
  checked?: boolean;
  disabled?: boolean;
}>) {
  const onChange = useBoundValue<boolean>(bindings, emit, "checked");
  return (
    <label className="object-row flex cursor-pointer items-center justify-between gap-2 rounded-[12px] border border-[var(--object-row-border)] px-3 py-2">
      <LabelDescription label={props.label} description={props.description} />
      <Checkbox
        checked={props.checked === true}
        onCheckedChange={(value) => onChange(value === true)}
        disabled={props.disabled === true}
      />
    </label>
  );
}

export function CatalogInput({
  props,
  emit,
  bindings,
}: BaseProps<{
  label?: string;
  placeholder?: string;
  value?: string;
  disabled?: boolean;
}>) {
  const onChange = useBoundValue<string>(bindings, emit, "value");
  return (
    <label className="flex flex-col gap-1">
      <FieldLabel text={props.label} />
      <UiInput
        value={props.value ?? ""}
        placeholder={props.placeholder}
        disabled={props.disabled === true}
        onChange={(e) => onChange(e.currentTarget.value)}
      />
    </label>
  );
}

export function CatalogTextarea({
  props,
  emit,
  bindings,
}: BaseProps<{
  label?: string;
  placeholder?: string;
  value?: string;
  rows?: number;
  disabled?: boolean;
}>) {
  const onChange = useBoundValue<string>(bindings, emit, "value");
  return (
    <label className="flex flex-col gap-1">
      <FieldLabel text={props.label} />
      <textarea
        className="object-row min-h-20 w-full resize-y rounded-[12px] border border-[var(--object-row-border)] px-2.5 py-1.5 text-xs outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-focus-ring"
        value={props.value ?? ""}
        placeholder={props.placeholder}
        rows={props.rows ?? 4}
        disabled={props.disabled === true}
        onChange={(e) => onChange(e.currentTarget.value)}
      />
    </label>
  );
}

export function CatalogSwitch({
  props,
  emit,
  bindings,
}: BaseProps<{
  label: string;
  description?: string;
  checked?: boolean;
  disabled?: boolean;
}>) {
  const onChange = useBoundValue<boolean>(bindings, emit, "checked");
  const checked = props.checked === true;
  return (
    // Stop propagation so toggling the switch inside a Row doesn't also fire the
    // row's `press` action (Row's interactive-child guard doesn't cover this).
    <div
      className="object-row flex items-center justify-between gap-2 rounded-[12px] border border-[var(--object-row-border)] py-1 pr-1 pl-3"
      onClick={(e) => e.stopPropagation()}
    >
      <LabelDescription label={props.label} description={props.description} />
      <Switch
        label=""
        checked={checked}
        onToggle={() => onChange(!checked)}
        disabled={props.disabled === true}
      />
    </div>
  );
}

export function CatalogSelect({
  props,
  emit,
  bindings,
}: BaseProps<{
  label?: string;
  placeholder?: string;
  value?: string;
  options?: CatalogOption[];
  disabled?: boolean;
}>) {
  const onChange = useBoundValue<string>(bindings, emit, "value");
  const options = props.options ?? [];
  return (
    <div className="flex flex-col gap-1">
      <FieldLabel text={props.label} />
      <Select
        items={options}
        value={props.value ?? ""}
        onValueChange={(value) => onChange(typeof value === "string" ? value : "")}
        disabled={props.disabled === true}
      >
        <SelectTrigger className="w-full">
          <SelectValue placeholder={props.placeholder ?? "Select…"} />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function CatalogRadioGroup({
  props,
  emit,
  bindings,
}: BaseProps<{
  label?: string;
  value?: string;
  options?: Array<CatalogOption & { description?: string }>;
  disabled?: boolean;
}>) {
  const onChange = useBoundValue<string>(bindings, emit, "value");
  const options = props.options ?? [];
  return (
    <div className="flex flex-col gap-2">
      <FieldLabel text={props.label} />
      <RadioGroup
        value={props.value ?? ""}
        onValueChange={(value) => onChange(typeof value === "string" ? value : "")}
        disabled={props.disabled === true}
      >
        {options.map((option) => (
          <label key={option.value} className="flex cursor-pointer items-start gap-2">
            <RadioGroupItem value={option.value} className="mt-0.5" />
            <LabelDescription label={option.label} description={option.description} />
          </label>
        ))}
      </RadioGroup>
    </div>
  );
}

export function CatalogSlider({
  props,
  emit,
  bindings,
}: BaseProps<{
  label?: string;
  value?: number;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
}>) {
  const onChange = useBoundValue<number>(bindings, emit, "value");
  const min = props.min ?? 0;
  const max = props.max ?? 100;
  const value = typeof props.value === "number" ? props.value : min;
  const handleChange = (next: SliderValue) => {
    onChange(Array.isArray(next) ? (next[0] ?? min) : next);
  };
  return (
    // Stop propagation so dragging/clicking the slider inside a Row doesn't also
    // fire the row's `press` action.
    <div
      className="flex flex-col gap-1 px-1"
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <Slider
        label={props.label}
        value={value}
        onChange={handleChange}
        min={min}
        max={max}
        step={props.step ?? 1}
        disabled={props.disabled === true}
      />
    </div>
  );
}
