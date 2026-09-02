import { PlateElement, type PlateElementProps } from "platejs/react";

import { cn } from "@repo/ui/lib/utils";

import { stringProp } from "@repo/editor/node-props";

// a Map, not a record: a variant is whatever the source note wrote.
const VARIANT_ACCENTS = new Map([
  ["caution", "border-red-500/60 bg-red-500/[0.05]"],
  ["error", "border-red-500/60 bg-red-500/[0.05]"],
  ["info", "border-blue-500/60 bg-blue-500/[0.05]"],
  ["note", "border-blue-500/60 bg-blue-500/[0.05]"],
  ["priority", "border-red-500/60 bg-red-500/[0.05]"],
  ["tip", "border-emerald-500/60 bg-emerald-500/[0.05]"],
  ["warning", "border-amber-500/60 bg-amber-500/[0.05]"],
]);

export function CalloutElement(props: PlateElementProps) {
  const variant = stringProp(props.element, "variant")?.toLowerCase() ?? "";
  const icon = stringProp(props.element, "icon") ?? null;
  const accent = VARIANT_ACCENTS.get(variant) ?? "border-border bg-muted/40";

  return (
    <PlateElement
      {...props}
      className={cn(
        "relative rounded-md border-l-[3px] py-2 pr-3 [&>*]:my-0",
        accent,
        icon ? "pl-9" : "pl-4",
      )}
    >
      {icon ? (
        <span contentEditable={false} className="absolute top-2 left-3 select-none">
          {icon}
        </span>
      ) : null}
      {props.children}
    </PlateElement>
  );
}
