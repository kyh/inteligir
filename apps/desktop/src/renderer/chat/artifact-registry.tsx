// ---------------------------------------------------------------------------
// json-render component registry for artifact panels. Each implementation
// maps a catalog component onto a shadcn (@repo/ui) primitive so artifact
// UIs match the rest of the app. Components emit events ("press", "change")
// which the renderer resolves against each element's `on` field.
// ---------------------------------------------------------------------------

import { defineRegistry, useStateStore } from "@json-render/react";
import { Button } from "@repo/ui/components/button";
import { Checkbox } from "@repo/ui/components/checkbox";
import { Input as UiInput } from "@repo/ui/components/input";
import { Label } from "@repo/ui/components/label";
import { Separator } from "@repo/ui/components/separator";
import { cn } from "@repo/ui/lib/utils";

import { artifactCatalog } from "@/renderer/chat/artifact-catalog";

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

function Row({ props, children }: BaseProps<{ bordered?: boolean }>) {
  const bordered = props.bordered !== false;
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-2",
        bordered && "rounded-md border border-border px-3 py-2",
      )}
    >
      {children}
    </div>
  );
}

function Heading({ props }: BaseProps<{ text: string; level?: "1" | "2" | "3" }>) {
  const level = props.level ?? "3";
  if (level === "1") return <h1 className="text-base font-semibold">{props.text}</h1>;
  if (level === "2") return <h2 className="text-sm font-semibold">{props.text}</h2>;
  return <h3 className="text-xs font-medium text-muted-foreground">{props.text}</h3>;
}

function Text({
  props,
}: BaseProps<{ text: string; muted?: boolean; size?: "xs" | "sm" | "base" }>) {
  // Default size "sm" maps to text-xs (12px), matching the app's standard body
  // size. "xs" is text-[11px] for captions, "base" is text-sm (14px).
  const size = props.size ?? "sm";
  const sizeClass = size === "base" ? "text-sm" : size === "sm" ? "text-xs" : "text-[11px]";
  return (
    <span className={cn(sizeClass, props.muted ? "text-muted-foreground" : "text-foreground")}>
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
      className="h-auto px-2 py-0.5 text-[10px] text-muted-foreground"
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
  const store = useStateStore();
  const bindPath = bindings?.["value"];
  return (
    <label className="flex flex-col gap-1">
      {props.label ? (
        <span className="text-[10px] font-medium text-muted-foreground">{props.label}</span>
      ) : null}
      <UiInput
        value={props.value ?? ""}
        placeholder={props.placeholder}
        disabled={props.disabled === true}
        onChange={(e) => {
          const next = e.currentTarget.value;
          if (bindPath) store.set(bindPath, next);
          emit("change");
        }}
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

export const { registry: artifactRegistry } = defineRegistry(artifactCatalog, {
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
    Card: CatalogCard,
    Separator: CatalogSeparator,
  },
  // Action stubs — real handlers are mounted per-viewer in artifact-viewer.tsx
  // so they can close over the bridge + toast singleton.
  actions: {
    notify: async () => {},
    openUrl: async () => {},
  },
});
