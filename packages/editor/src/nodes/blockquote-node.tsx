// Alerts stay plain blockquotes in the model; the marker is hidden by the calloutMarker
// decoration and revealed while the caret is inside (Obsidian live-preview convention).

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

import { cn } from "cn";

import { CALLOUT_ALERT, CALLOUT_EDITING } from "@repo/editor/style-hooks";

const ALERT_VARIANTS = ["NOTE", "TIP", "IMPORTANT", "WARNING", "CAUTION"] as const;

type AlertVariant = (typeof ALERT_VARIANTS)[number];

interface AlertPresentation {
  Icon: ComponentType<{ className?: string }>;
  accent: string;
  icon: string;
  label: string;
}

const ALERTS = {
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
} satisfies Record<AlertVariant, AlertPresentation>;

// strict form: the marker is the whole first line; `hidden` spans the marker plus its soft break.
const ALERT_MARKER_RE = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\](?:\n|$)/i;

// loose form keeps the marker visible: hiding non-marker bytes would lie.
const ALERT_LOOSE_RE = /^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i;

function toVariant(raw: string): AlertVariant | null {
  const upper = raw.toUpperCase();
  return ALERT_VARIANTS.find((variant) => variant === upper) ?? null;
}

export function alertPresentation(variant: AlertVariant): AlertPresentation {
  return ALERTS[variant];
}

export type { AlertVariant };

export function alertMarkerPrefix(text: string): { hidden: number; variant: AlertVariant } | null {
  const match = ALERT_MARKER_RE.exec(text);
  const variant = match ? toVariant(match[1] ?? "") : null;
  if (!match || !variant) return null;
  return { hidden: match[0].length, variant };
}

// the calloutMarker decoration runs the same alertMarkerPrefix, so badge and hiding cannot disagree.
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
    // hidden while editing so the label never doubles up with its own bytes.
    return (
      <PlateElement
        {...props}
        as="blockquote"
        className={cn(
          CALLOUT_ALERT,
          "rounded-md border-l-[3px] py-2 pr-3 pl-4 [&>*]:my-0",
          accent,
          selected && CALLOUT_EDITING,
        )}
      >
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
  return <PlateElement {...props} as="blockquote" />;
}
