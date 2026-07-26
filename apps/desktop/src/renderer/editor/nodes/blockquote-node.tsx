// GitHub-style alert blockquotes (`> [!NOTE] …`) render as colored callouts.
// They stay plain blockquotes in the model, so they round-trip byte-for-byte —
// the callout is purely presentational. When the alert's first line is exactly
// the `[!TYPE]` marker, the marker text is hidden at render behind a variant
// title badge (icon + label) and revealed while the caret is inside the quote
// (Obsidian live-preview convention: raw syntax shows exactly when you edit
// that block, so the bytes stay discoverable and editable). The hiding itself
// is a `calloutMarker` leaf decoration (kits/basic-blocks-kit.tsx) + CSS in
// styles.css — the document model never changes. The ALERTS map is shared with
// the `<callout>` compat renderer (callout-node.tsx).

import type { ComponentType } from "react";
import {
  InfoIcon,
  LightbulbIcon,
  OctagonAlertIcon,
  ShieldAlertIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { ElementApi, KEYS, NodeApi, TextApi, type SlateEditor, type TElement } from "platejs";
import { PlateElement, useSelected, type PlateElementProps } from "platejs/react";

import { cn } from "@repo/ui/lib/utils";

const ALERT_VARIANTS = ["NOTE", "TIP", "IMPORTANT", "WARNING", "CAUTION"] as const;

type AlertVariant = (typeof ALERT_VARIANTS)[number];

const ALERTS: Record<
  AlertVariant,
  { Icon: ComponentType<{ className?: string }>; accent: string; icon: string; label: string }
> = {
  NOTE: {
    Icon: InfoIcon,
    accent: "border-blue-500/60 bg-blue-500/[0.05]",
    icon: "text-blue-600 dark:text-blue-400",
    label: "Note",
  },
  TIP: {
    Icon: LightbulbIcon,
    accent: "border-emerald-500/60 bg-emerald-500/[0.05]",
    icon: "text-emerald-600 dark:text-emerald-400",
    label: "Tip",
  },
  IMPORTANT: {
    Icon: ShieldAlertIcon,
    accent: "border-violet-500/60 bg-violet-500/[0.05]",
    icon: "text-violet-600 dark:text-violet-400",
    label: "Important",
  },
  WARNING: {
    Icon: TriangleAlertIcon,
    accent: "border-amber-500/60 bg-amber-500/[0.05]",
    icon: "text-amber-600 dark:text-amber-400",
    label: "Warning",
  },
  CAUTION: {
    Icon: OctagonAlertIcon,
    accent: "border-red-500/60 bg-red-500/[0.05]",
    icon: "text-red-600 dark:text-red-400",
    label: "Caution",
  },
};

// Strict form only: the marker IS the whole first line (GitHub's alert
// grammar). `hidden` spans the marker plus its soft break, so hiding it pulls
// the body up to the first visible line.
const ALERT_MARKER_RE = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\](?:\n|$)/i;

// Legacy/loose form (`[!TIP] trailing words`): still tinted like an alert,
// but the marker stays visible — hiding non-marker bytes would lie.
const ALERT_LOOSE_RE = /^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i;

function toVariant(raw: string): AlertVariant | null {
  const upper = raw.toUpperCase();
  return ALERT_VARIANTS.find((variant) => variant === upper) ?? null;
}

/** The variant's presentation (icon, tint, label). Exported so the read-only
 * static path (transclusion.tsx) renders an identical badge instead of
 * re-deriving the vocabulary — a second copy drifts, and the drift shows up
 * as a transcluded card that disagrees with the live editor. */
export function alertPresentation(variant: AlertVariant): (typeof ALERTS)[AlertVariant] {
  return ALERTS[variant];
}

export type { AlertVariant };

/** Marker-line prefix of `text`, or null. `hidden` = chars to hide (marker +
 * trailing soft break). */
export function alertMarkerPrefix(text: string): { hidden: number; variant: AlertVariant } | null {
  const match = ALERT_MARKER_RE.exec(text);
  const variant = match ? toVariant(match[1] ?? "") : null;
  if (!match || !variant) return null;
  return { hidden: match[0].length, variant };
}

/** The badge-form marker of an alert blockquote: its first child is a
 * paragraph whose first leaf starts with a marker-only line. The calloutMarker
 * decoration (basic-blocks-kit.tsx) mirrors these checks through
 * alertMarkerPrefix, so badge and hiding can never disagree. */
function alertQuoteMarker(
  editor: SlateEditor,
  quote: TElement,
): { hidden: number; variant: AlertVariant } | null {
  const first = quote.children[0];
  if (!ElementApi.isElement(first) || first.type !== editor.getType(KEYS.p)) return null;
  const leaf = first.children[0];
  if (!TextApi.isText(leaf)) return null;
  return alertMarkerPrefix(leaf.text);
}

export function BlockquoteElement(props: PlateElementProps) {
  const selected = useSelected();
  const marker = alertQuoteMarker(props.editor, props.element);
  if (marker) {
    const { Icon, accent, icon, label } = ALERTS[marker.variant];
    return (
      <PlateElement
        {...props}
        as="blockquote"
        className={cn(
          "callout-alert rounded-md border-l-[3px] py-2 pr-3 pl-4 [&>*]:my-0",
          accent,
          selected && "callout-editing",
        )}
      >
        {/* The badge swaps with the raw marker line: hidden while editing so
            the variant label never doubles up with its own bytes. */}
        <div
          contentEditable={false}
          className={cn(
            "flex items-center gap-1.5 py-[3px] text-[13px] leading-[1.3] font-semibold select-none",
            icon,
            selected && "hidden",
          )}
        >
          <Icon className="size-4" />
          {label}
        </div>
        {props.children}
      </PlateElement>
    );
  }
  const loose = ALERT_LOOSE_RE.exec(NodeApi.string(props.element));
  const looseVariant = loose ? toVariant(loose[1] ?? "") : null;
  if (looseVariant) {
    const { Icon, accent, icon } = ALERTS[looseVariant];
    return (
      <PlateElement
        {...props}
        as="blockquote"
        className={cn("relative rounded-md border-l-[3px] py-2 pr-3 pl-9 [&>*]:my-0", accent)}
      >
        <span contentEditable={false} className={cn("absolute top-[9px] left-3", icon)}>
          <Icon className="size-4" />
        </span>
        {props.children}
      </PlateElement>
    );
  }
  // Plain blockquote typography (rule, padding, flow margin) comes from typeset.
  return <PlateElement {...props} as="blockquote" />;
}
