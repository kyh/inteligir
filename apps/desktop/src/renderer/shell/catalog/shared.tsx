// ---------------------------------------------------------------------------
// Shared types + hooks for the widget-catalog component renderers (layout /
// inputs / display / overlays). These are the json-render component
// implementations assembled into the registry by ../widget-registry.tsx.
// ---------------------------------------------------------------------------

import { useStateStore } from "@json-render/react";

// Every catalog component receives the same shape from json-render: resolved
// `props`, optional `children`, an `emit` to fire the element's bound events
// ("press" / "change"), and the `bindings` map (event-prop → state path).
export type BaseProps<P> = {
  props: P;
  children?: React.ReactNode;
  emit: (event: string) => void;
  bindings?: Record<string, string>;
};

export type CatalogOption = { label: string; value: string };

// Two-way bind for the interactive inputs: write the new value to the bound
// state path (when the element binds one) and emit the change event. Callers
// own value extraction (e.g. `e.currentTarget.value`, `!checked`) so the type
// they pass stays explicit; this hook only centralizes the bind + emit.
export function useBoundValue<T>(
  bindings: Record<string, string> | undefined,
  emit: (event: string) => void,
  key: string,
): (next: T) => void {
  const store = useStateStore();
  const bindPath = bindings?.[key];
  return (next: T) => {
    if (bindPath) store.set(bindPath, next);
    emit("change");
  };
}

/** The small caption-style label above a field (Input/Textarea/Select/Radio).
 * `text | undefined` (not just optional) so call sites can forward an
 * already-optional prop under exactOptionalPropertyTypes. */
export function FieldLabel({ text }: { text?: string | undefined }) {
  if (!text) return null;
  return <span className="text-[10px] font-medium text-muted-foreground">{text}</span>;
}

/** A label with an optional secondary description line — the in-row pattern
 * shared by Checkbox, Switch, and each RadioGroup option. */
export function LabelDescription({
  label,
  description,
}: {
  label: string;
  description?: string | undefined;
}) {
  return (
    <span className="flex flex-col">
      <span className="text-xs text-foreground">{label}</span>
      {description ? (
        <span className="text-[10px] text-muted-foreground">{description}</span>
      ) : null}
    </span>
  );
}
