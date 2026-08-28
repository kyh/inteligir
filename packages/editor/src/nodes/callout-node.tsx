// Compat renderer for `<callout>` MDX blocks. The vocabulary admits them (the
// agent or an imported note may contain one; Plate's defaultRules round-trip
// them) but the PRODUCT never creates one — our slash "Callout" stays the
// GitHub-alert blockquote. Renders in the alert family's visual language:
// left accent keyed on the `variant` attr, optional leading `icon` text,
// children editable. Unknown variants fall to a neutral accent.

import { PlateElement, type PlateElementProps } from "platejs/react";

import { cn } from "@repo/ui/lib/utils";

import { stringProp } from "@repo/editor/node-props";

// Accents mirror nodes/blockquote-node.tsx's ALERTS palette (string-keyed on
// the callout's own variant names rather than GH marker names). A variant is
// whatever the source note wrote, so the lookup is a Map rather than a record
// whose keys would claim to be the whole vocabulary.
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
