// GitHub-style alert blockquotes (`> [!NOTE] …`) render as colored callouts.
// They stay plain blockquotes in the model, so they round-trip byte-for-byte —
// the callout is purely presentational (the `[!TYPE]` marker stays in the
// text). Relocated verbatim from markdown-editor.tsx in WP2; the ALERTS map is
// shared with the `<callout>` compat renderer (callout-node.tsx).

import type { ComponentType } from "react";
import {
  InfoIcon,
  LightbulbIcon,
  OctagonAlertIcon,
  ShieldAlertIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { NodeApi } from "platejs";
import { PlateElement, type PlateElementProps } from "platejs/react";

import { cn } from "@repo/ui/lib/utils";

const ALERTS: Record<
  string,
  { Icon: ComponentType<{ className?: string }>; accent: string; icon: string }
> = {
  NOTE: {
    Icon: InfoIcon,
    accent: "border-blue-500/60 bg-blue-500/[0.05]",
    icon: "text-blue-600 dark:text-blue-400",
  },
  TIP: {
    Icon: LightbulbIcon,
    accent: "border-emerald-500/60 bg-emerald-500/[0.05]",
    icon: "text-emerald-600 dark:text-emerald-400",
  },
  IMPORTANT: {
    Icon: ShieldAlertIcon,
    accent: "border-violet-500/60 bg-violet-500/[0.05]",
    icon: "text-violet-600 dark:text-violet-400",
  },
  WARNING: {
    Icon: TriangleAlertIcon,
    accent: "border-amber-500/60 bg-amber-500/[0.05]",
    icon: "text-amber-600 dark:text-amber-400",
  },
  CAUTION: {
    Icon: OctagonAlertIcon,
    accent: "border-red-500/60 bg-red-500/[0.05]",
    icon: "text-red-600 dark:text-red-400",
  },
};

export function BlockquoteElement(props: PlateElementProps) {
  const marker = /^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i.exec(
    NodeApi.string(props.element),
  );
  const variant = marker?.[1]?.toUpperCase();
  const alert = variant ? ALERTS[variant] : undefined;
  if (alert) {
    const { Icon, accent, icon } = alert;
    return (
      <PlateElement
        {...props}
        as="blockquote"
        className={cn("relative my-1 rounded-md border-l-[3px] py-2 pr-3 pl-9 [&>*]:my-0", accent)}
      >
        <span contentEditable={false} className={cn("absolute top-[9px] left-3", icon)}>
          <Icon className="size-4" />
        </span>
        {props.children}
      </PlateElement>
    );
  }
  return (
    <PlateElement
      {...props}
      as="blockquote"
      className="my-1 border-l-[3px] border-foreground px-4 py-[3px]"
    />
  );
}
