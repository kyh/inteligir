// ---------------------------------------------------------------------------
// json-render component registry for the settings panel.
//
// Each implementation here maps a catalog type onto an existing @repo/ui
// shadcn component so the JSON-driven panel feels visually identical to the
// rest of Inteligir. Components access two-way state via `bindings` for
// inputs (Checkbox) and emit named events (`emit("press")`) for buttons
// — the renderer then resolves the event to an action via the element's
// `on` field.
// ---------------------------------------------------------------------------

import { defineRegistry, useStateStore } from "@json-render/react";
import { Button } from "@repo/ui/components/button";
import { Checkbox } from "@repo/ui/components/checkbox";
import { Label } from "@repo/ui/components/label";
import { cn } from "@repo/ui/lib/utils";

import { settingsCatalog } from "@/renderer/chat/settings-catalog";

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

function Section({
  props,
  children,
}: BaseProps<{ title?: string }>) {
  return (
    <div className="flex flex-col gap-2">
      {props.title ? (
        <Label className="text-xs font-medium text-muted-foreground">{props.title}</Label>
      ) : null}
      {children}
    </div>
  );
}

function Row({
  props,
  children,
}: BaseProps<{ bordered?: boolean }>) {
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
  const size = props.size ?? "xs";
  return (
    <span
      className={cn(
        size === "base" ? "text-sm" : size === "sm" ? "text-xs" : "text-xs",
        size === "xs" && "text-[11px]",
        props.muted ? "text-muted-foreground" : "text-foreground",
      )}
    >
      {props.text}
    </span>
  );
}

function TextBlock({
  props,
}: BaseProps<{ title: string; description?: string }>) {
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

function CatalogCard({ children }: BaseProps<Record<string, never>>) {
  return <div className="rounded-md border border-border p-3">{children}</div>;
}

export const { registry: settingsRegistry } = defineRegistry(settingsCatalog, {
  components: {
    Stack,
    Section,
    Row,
    Heading,
    Text,
    TextBlock,
    Button: CatalogButton,
    Checkbox: CatalogCheckbox,
    Card: CatalogCard,
  },
  // Action handlers are provided per-mount in settings-panel.tsx so they can
  // close over the live bridge / store. The catalog-required `actions` field
  // here is just stub identifiers — the real impls live with the renderer.
  actions: {
    logout: async () => {},
    newSession: async () => {},
    setNotifications: async () => {},
    resetUiSettings: async () => {},
  },
});
