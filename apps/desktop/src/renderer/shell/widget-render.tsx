// Shared resolution of a placed instance to its rendered body + chrome props,
// used by both the grid (Panel) and floating windows (FloatingWindow).

import { BUILTIN_WIDGET_UI } from "@/renderer/shell/builtin-widgets";
import { WidgetViewer } from "@/renderer/shell/widget-viewer";
import { getBridge } from "@/renderer/lib/bridge";
import { builtinMeta, type CustomWidgetDef, type WidgetInstance } from "@/shared/shell";

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

/** Close (unplace) an instance — the definition survives in the dock and can
 * be re-placed. Deleting a custom definition is a separate gesture
 * (manage_ui delete from the agent). */
export function closeInstance(instance: WidgetInstance): void {
  void getBridge()?.unplaceWidget(instance.instanceId);
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
