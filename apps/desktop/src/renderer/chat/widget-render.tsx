// Shared resolution of a placed instance to its rendered body + chrome props,
// used by both the grid (Panel) and floating windows (FloatingWindow).

import { BUILTIN_WIDGET_UI } from "@/renderer/chat/builtin-widgets";
import { WidgetViewer } from "@/renderer/chat/widget-viewer";
import { getBridge } from "@/renderer/lib/bridge";
import { builtinMeta, type CustomWidgetDef, type WidgetInstance } from "@/shared/shell";

export function widgetTitle(instance: WidgetInstance, customDef?: CustomWidgetDef): string {
  return builtinMeta(instance.widgetId)?.title ?? customDef?.title ?? instance.widgetId;
}

export function widgetBodyClassName(instance: WidgetInstance): string | undefined {
  const meta = builtinMeta(instance.widgetId);
  return meta ? BUILTIN_WIDGET_UI[meta.id].bodyClassName : undefined;
}

export function isPermanentInstance(instance: WidgetInstance): boolean {
  return builtinMeta(instance.widgetId)?.permanent ?? false;
}

/** Close an instance: built-ins hide back to the dock (unplace); custom
 * instances delete their definition (no gallery to re-place them from). */
export function closeInstance(instance: WidgetInstance): void {
  if (builtinMeta(instance.widgetId)) {
    void getBridge()?.unplaceWidget(instance.instanceId);
  } else {
    void getBridge()?.deleteWidget(instance.widgetId);
  }
}

export function WidgetBody({
  instance,
  customDef,
}: {
  instance: WidgetInstance;
  customDef?: CustomWidgetDef;
}) {
  const meta = builtinMeta(instance.widgetId);
  if (meta) {
    const Body = BUILTIN_WIDGET_UI[meta.id].component;
    return <Body />;
  }
  if (!customDef) {
    return <div className="p-3 text-xs text-muted-foreground">This widget is unavailable.</div>;
  }
  return <WidgetViewer instance={instance} spec={customDef.spec} />;
}
