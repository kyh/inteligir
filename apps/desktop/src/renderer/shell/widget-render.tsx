// Shared resolution of a placed instance + its def to rendered body + chrome
// props, used by both the grid (Panel) and floating windows (FloatingWindow).

import { LayoutPanelLeftIcon } from "lucide-react";
import { toast } from "@repo/ui/components/sonner";

import { BUILTIN_WIDGET_UI } from "@/renderer/shell/builtin-widgets";
import { flushInstanceState } from "@/renderer/shell/instance-state-flush";
import { WidgetViewer } from "@/renderer/shell/widget-viewer";
import { getBridge } from "@/renderer/lib/bridge";
import {
  isBuiltin,
  isJsonUi,
  type WidgetDef,
  type WidgetInstance,
  type WidgetSurface,
} from "@/shared/shell";

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
  return def && isBuiltin(def) ? BUILTIN_WIDGET_UI[def.id].bodyClassName : undefined;
}

export function widgetIcon(def: WidgetDef): React.ComponentType<{ className?: string }> {
  return isBuiltin(def) ? BUILTIN_WIDGET_UI[def.id].icon : LayoutPanelLeftIcon;
}

/** Close (unplace) an instance — the definition survives in the dock and can
 * be re-placed. Flushes any pending state first so the archive (and a later
 * re-place) reflects the user's last edits, not what was on disk pre-debounce.
 * Deleting a custom definition is a separate gesture (manage_ui delete). */
export async function closeInstance(instance: WidgetInstance): Promise<void> {
  if (!(await flushInstanceState(instance.instanceId))) {
    toast.error("Couldn't save the latest changes — close cancelled.");
    return;
  }
  await getBridge()?.unplaceWidget(instance.instanceId);
}

/** Move an instance between surfaces (pinned grid ⇄ floating window). Flushes
 * first so the broadcast that triggers the remount carries the latest state.
 * Unlike unplace, surface changes don't trigger a second main-side flush, so
 * a quiet flush failure here would seed the remounted viewer with stale
 * state — cancel instead. */
export async function moveInstance(instanceId: string, surface: WidgetSurface): Promise<void> {
  if (!(await flushInstanceState(instanceId))) {
    toast.error("Couldn't save the latest changes — move cancelled.");
    return;
  }
  await getBridge()?.setInstanceSurface(instanceId, surface);
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
  if (isBuiltin(def)) {
    const Body = BUILTIN_WIDGET_UI[def.id].component;
    return <Body />;
  }
  if (isJsonUi(def)) return <WidgetViewer instance={instance} def={def} />;
  return <div className="p-3 text-xs text-muted-foreground">This widget is unavailable.</div>;
}
