// Shared resolution of a placed instance + its def to rendered body + chrome
// props, used by both the grid (Panel) and floating windows (FloatingWindow).

import { LayoutPanelLeftIcon } from "lucide-react";

import { BUILTIN_WIDGET_UI } from "@/renderer/shell/builtin-widgets";
import { WidgetViewer } from "@/renderer/shell/widget-viewer";
import { getBridge } from "@/renderer/lib/bridge";
import type { BuiltinWidgetId, WidgetDef, WidgetInstance } from "@/shared/shell";

/** A panel/window header action button. Stops mouse + pointer propagation so
 * it doesn't trigger the grid drag handle or a floating-window drag. */
export function ChromeButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      className="rounded p-0.5 text-muted-foreground/60 hover:bg-muted hover:text-foreground"
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function widgetTitle(def: WidgetDef | undefined, instance: WidgetInstance): string {
  return def?.title ?? instance.widgetId;
}

export function widgetBodyClassName(def: WidgetDef | undefined): string | undefined {
  return def?.source.kind === "builtin"
    ? BUILTIN_WIDGET_UI[def.id as BuiltinWidgetId]?.bodyClassName
    : undefined;
}

export function widgetIcon(def: WidgetDef): React.ComponentType<{ className?: string }> {
  return def.source.kind === "builtin"
    ? BUILTIN_WIDGET_UI[def.id as BuiltinWidgetId].icon
    : LayoutPanelLeftIcon;
}

/** Close (unplace) an instance — the definition survives in the dock and can
 * be re-placed. Deleting a custom definition is a separate gesture
 * (manage_ui delete from the agent). */
export function closeInstance(instance: WidgetInstance): void {
  void getBridge()?.unplaceWidget(instance.instanceId);
}

export function WidgetBody({
  def,
  instance,
}: {
  def: WidgetDef | undefined;
  instance: WidgetInstance;
}) {
  if (!def) {
    return <div className="p-3 text-xs text-muted-foreground">This widget is unavailable.</div>;
  }
  if (def.source.kind === "builtin") {
    const Body = BUILTIN_WIDGET_UI[def.id as BuiltinWidgetId].component;
    return <Body />;
  }
  return <WidgetViewer instance={instance} spec={def.source.spec} />;
}
