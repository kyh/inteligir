// ---------------------------------------------------------------------------
// json-render component registry for widget panels. Each implementation maps a
// catalog component onto a shadcn (@repo/ui) primitive so widgets match the
// rest of the app. Components emit events ("press", "change") which the
// renderer resolves against each element's `on` field.
// ---------------------------------------------------------------------------

import { defineRegistry, useStateStore } from "@json-render/react";
import { Button } from "@repo/ui/components/button";
import { Checkbox } from "@repo/ui/components/checkbox";
import { Input as UiInput } from "@repo/ui/components/input";
import { Label } from "@repo/ui/components/label";
import { Separator } from "@repo/ui/components/separator";
import { cn } from "@repo/ui/lib/utils";

import { widgetCatalog } from "@/renderer/shell/widget-catalog";

type BaseProps<P> = {
  props: P;
  children?: React.ReactNode;
  emit: (event: string) => void;
  bindings?: Record<string, string>;
};

const gapClass = (gap?: "sm" | "md" | "lg") =>
  gap === "sm" ? "gap-2" : gap === "md" ? "gap-3" : "gap-4";

function Stack({ props, children }: BaseProps<{ gap?: "sm" | "md" | "lg" }>) {
  return <div className={cn("flex flex-col", gapClass(props.gap))}>{children}</div>;
}

function Section({ props, children }: BaseProps<{ title?: string }>) {
  return (
    <div className="flex flex-col gap-2">
      {props.title ? (
        <Label className="text-xs font-medium text-muted-foreground">{props.title}</Label>
      ) : null}
      {children}
    </div>
  );
}

function Row({ props, emit, children }: BaseProps<{ bordered?: boolean }>) {
  const bordered = props.bordered !== false;
  return (
    <div
      onClick={() => emit("press")}
      className={cn(
        "flex items-center justify-between gap-2",
        bordered && "rounded-md border border-border px-3 py-2",
      )}
    >
      {children}
    </div>
  );
}

const headingClass = {
  "1": "text-base font-semibold",
  "2": "text-sm font-semibold",
  "3": "text-xs font-medium text-muted-foreground",
} as const;

function Heading({ props }: BaseProps<{ text: string; level?: "1" | "2" | "3" }>) {
  const level = props.level ?? "3";
  const className = headingClass[level];
  if (level === "1") return <h1 className={className}>{props.text}</h1>;
  if (level === "2") return <h2 className={className}>{props.text}</h2>;
  return <h3 className={className}>{props.text}</h3>;
}

// "sm" (12px) is the default body size. "xs" (11px) is for captions, "base"
// (14px) for emphasized inline text.
const textSizeClass = {
  xs: "text-[11px]",
  sm: "text-xs",
  base: "text-sm",
} as const;

function Text({
  props,
}: BaseProps<{ text: string; muted?: boolean; size?: "xs" | "sm" | "base" }>) {
  return (
    <span
      className={cn(
        textSizeClass[props.size ?? "sm"],
        props.muted ? "text-muted-foreground" : "text-foreground",
      )}
    >
      {props.text}
    </span>
  );
}

function TextBlock({ props }: BaseProps<{ title: string; description?: string }>) {
  return (
    <span className="flex flex-col">
      <span className="text-xs text-foreground">{props.title}</span>
      {props.description ? (
        <span className="text-[10px] text-muted-foreground">{props.description}</span>
      ) : null}
    </span>
  );
}

function CatalogButton({
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

function CatalogCheckbox({
  props,
  emit,
  bindings,
}: BaseProps<{
  label: string;
  description?: string;
  checked?: boolean;
  disabled?: boolean;
}>) {
  const store = useStateStore();
  const bindPath = bindings?.["checked"];
  const checked = props.checked === true;
  const handleChange = (next: boolean) => {
    if (bindPath) store.set(bindPath, next);
    emit("change");
  };
  return (
    <label className="flex cursor-pointer items-center justify-between gap-2 rounded-md border border-border px-3 py-2">
      <span className="flex flex-col">
        <span className="text-xs text-foreground">{props.label}</span>
        {props.description ? (
          <span className="text-[10px] text-muted-foreground">{props.description}</span>
        ) : null}
      </span>
      <Checkbox
        checked={checked}
        onCheckedChange={(value) => handleChange(value === true)}
        disabled={props.disabled === true}
      />
    </label>
  );
}

// Shared two-way-bind handler for the text field components: write the new
// value to the bound state path (if any) and emit the change event.
function useBoundTextChange(bindings: Record<string, string> | undefined, emit: (event: string) => void) {
  const store = useStateStore();
  const bindPath = bindings?.["value"];
  return (next: string) => {
    if (bindPath) store.set(bindPath, next);
    emit("change");
  };
}

function CatalogInput({
  props,
  emit,
  bindings,
}: BaseProps<{
  label?: string;
  placeholder?: string;
  value?: string;
  disabled?: boolean;
}>) {
  const onValueChange = useBoundTextChange(bindings, emit);
  return (
    <label className="flex flex-col gap-1">
      {props.label ? (
        <span className="text-[10px] font-medium text-muted-foreground">{props.label}</span>
      ) : null}
      <UiInput
        value={props.value ?? ""}
        placeholder={props.placeholder}
        disabled={props.disabled === true}
        onChange={(e) => onValueChange(e.currentTarget.value)}
      />
    </label>
  );
}

function CatalogTextarea({
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
  const onValueChange = useBoundTextChange(bindings, emit);
  return (
    <label className="flex flex-col gap-1">
      {props.label ? (
        <span className="text-[10px] font-medium text-muted-foreground">{props.label}</span>
      ) : null}
      <textarea
        className="min-h-20 w-full resize-y rounded-md border border-border bg-transparent px-2 py-1 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
        value={props.value ?? ""}
        placeholder={props.placeholder}
        rows={props.rows ?? 4}
        disabled={props.disabled === true}
        onChange={(e) => onValueChange(e.currentTarget.value)}
      />
    </label>
  );
}

function CatalogCard({ children }: BaseProps<Record<string, never>>) {
  return <div className="rounded-md border border-border p-3">{children}</div>;
}

function CatalogSeparator() {
  return <Separator />;
}

export const { registry: widgetRegistry } = defineRegistry(widgetCatalog, {
  components: {
    Stack,
    Section,
    Row,
    Heading,
    Text,
    TextBlock,
    Button: CatalogButton,
    Checkbox: CatalogCheckbox,
    Input: CatalogInput,
    Textarea: CatalogTextarea,
    Card: CatalogCard,
    Separator: CatalogSeparator,
  },
  // Action stubs — real handlers are mounted per-viewer in widget-viewer.tsx
  // so they can close over the bridge, store, and toast singleton.
  actions: {
    notify: async () => {},
    openUrl: async () => {},
    sendPrompt: async () => {},
    generateText: async () => {},
    fetchUrl: async () => {},
  },
});
