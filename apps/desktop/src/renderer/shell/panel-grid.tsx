import { memo, useCallback, useEffect, useMemo } from "react";
import { Maximize2Icon, XIcon } from "lucide-react";
import { GridLayout, useContainerWidth, type Layout, type LayoutItem } from "react-grid-layout";
import type { GridConfig, ResizeConfig } from "react-grid-layout/core";
import "react-grid-layout/css/styles.css";

import { cn } from "@repo/ui/lib/utils";

import { FloatingLayer } from "@/renderer/shell/floating-layer";
import {
  ChromeButton,
  closeInstance,
  moveInstance,
  WidgetBody,
  widgetBodyClassName,
  widgetIcon,
  widgetTitle,
} from "@/renderer/shell/widget-render";
import { getBridge } from "@/renderer/lib/bridge";
import { initShell, useShellStore } from "@/renderer/stores/shell-store";
import {
  isPinned,
  isBuiltin,
  type PinnedInstance,
  type WidgetDef,
  type WidgetGeometry,
  type WidgetInstance,
} from "@/shared/shell";

// ---------------------------------------------------------------------------
// Workspace ("shell")
//
// A 12-column grid of pinned widget instances. Floating ("app window")
// instances render above it via FloatingLayer. Permanent defs (chat) can be
// popped between surfaces but never removed.
// ---------------------------------------------------------------------------

const GRID_CONFIG: Partial<GridConfig> = {
  cols: 12,
  rowHeight: 40,
  margin: [16, 16],
  containerPadding: [0, 0],
};
const DRAG_CONFIG = { enabled: true, bounded: false, handle: ".panel-drag-handle" };
const RESIZE_CONFIG: Partial<ResizeConfig> = { enabled: true, handles: ["se", "e", "s"] };

type PanelVariant = "artifact" | "panel";

function instanceToLayoutItem(i: PinnedInstance): LayoutItem {
  return { i: i.instanceId, ...i.placement.geometry };
}

function geometryFromLayoutItem(item: LayoutItem): WidgetGeometry {
  const geo: WidgetGeometry = { x: item.x, y: item.y, w: item.w, h: item.h };
  if (item.minW !== undefined) geo.minW = item.minW;
  if (item.minH !== undefined) geo.minH = item.minH;
  return geo;
}

// ---------------------------------------------------------------------------
// Panel chrome
// ---------------------------------------------------------------------------

function Panel({
  icon: Icon,
  title,
  children,
  bodyClassName,
  variant,
  onPopOut,
  onRemove,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: React.ReactNode;
  children: React.ReactNode;
  bodyClassName?: string | undefined;
  variant: PanelVariant;
  onPopOut?: () => void;
  onRemove?: () => void;
}) {
  // Custom widgets and floating windows now share the same simple anatomy:
  // lifted object pane, integrated titlebar, direct body surface.
  const actions = (
    <>
      {onPopOut ? (
        <ChromeButton label="Pop out to window" onClick={onPopOut}>
          <Maximize2Icon className="size-3.5" />
        </ChromeButton>
      ) : null}
      {onRemove ? (
        <ChromeButton label="Close panel" onClick={onRemove}>
          <XIcon className="size-3.5" />
        </ChromeButton>
      ) : null}
    </>
  );

  if (variant === "artifact") {
    return (
      <div className="group/panel artifact-frame flex h-full w-full min-w-0 flex-col overflow-hidden rounded-[var(--radius-card)]">
        <div className="panel-drag-handle artifact-titlebar flex h-7 shrink-0 cursor-move items-center justify-between gap-2 px-2.5">
          <div className="flex min-w-0 items-center gap-1.5">
            <Icon className="size-3.5 shrink-0 text-[rgba(19,20,27,0.34)]" />
            <span className="truncate text-[13px] leading-4 font-normal text-[rgba(19,20,27,0.48)]">
              {title}
            </span>
          </div>
          <div className="artifact-actions flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover/panel:opacity-100 group-focus-within/panel:opacity-100">
            {actions}
          </div>
        </div>
        <div className={cn("artifact-body min-h-0 flex-1 overflow-auto", bodyClassName)}>
          {children}
        </div>
      </div>
    );
  }

  return (
    <div className="group/panel flex h-full w-full flex-col overflow-visible rounded-[var(--radius-card)]">
      <div className="flex h-full w-full min-w-0 flex-col">
        <div className="panel-drag-handle flex h-6 shrink-0 cursor-move items-center justify-between gap-2 px-1.5">
          <div className="flex min-w-0 items-center gap-1.5">
            <Icon className="size-3.5 shrink-0 text-[rgba(19,20,27,0.34)]" />
            <span className="truncate text-[13px] leading-4 font-normal text-[rgba(19,20,27,0.44)]">
              {title}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover/panel:opacity-100 group-focus-within/panel:opacity-100">
            {actions}
          </div>
        </div>
        <div
          className={cn(
            "min-h-0 flex-1 overflow-auto rounded-[var(--radius-card)] border object-pane",
            bodyClassName,
          )}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

// memo'd on instance + def identity (reused by the store reconcile for
// unchanged widgets), so a floating-only change doesn't re-render every panel.
const InstancePanel = memo(function InstancePanel({
  instance,
  def,
}: {
  instance: WidgetInstance;
  def: WidgetDef | undefined;
}) {
  const variant: PanelVariant = def && !isBuiltin(def) ? "artifact" : "panel";
  return (
    <Panel
      icon={widgetIcon(def)}
      title={widgetTitle(def, instance)}
      bodyClassName={widgetBodyClassName(def)}
      variant={variant}
      onPopOut={() => void moveInstance(instance.instanceId, "floating")}
      onRemove={() => void closeInstance(instance)}
    >
      <WidgetBody def={def} instance={instance} />
    </Panel>
  );
});

// ---------------------------------------------------------------------------
// Grid
// ---------------------------------------------------------------------------

export function PanelGrid() {
  const { width, containerRef } = useContainerWidth();

  useEffect(() => {
    initShell();
  }, []);
  const instances = useShellStore((s) => s.instances);
  const defs = useShellStore((s) => s.defs);
  const loading = useShellStore((s) => s.loading);

  const pinnedInstances = useMemo(() => instances.filter(isPinned), [instances]);
  const layout = useMemo(() => pinnedInstances.map(instanceToLayoutItem), [pinnedInstances]);
  const defById = useMemo(() => new Map(defs.map((d) => [d.id, d])), [defs]);

  // Persist geometry on drag/resize. Main compares against stored geometry and
  // only broadcasts on a real change, so the mount-time callback is a no-op.
  const handleLayoutChange = useCallback((next: Layout) => {
    const geometries: Record<string, WidgetGeometry> = {};
    for (const item of next) geometries[item.i] = geometryFromLayoutItem(item);
    void getBridge()?.setInstanceGeometry(geometries);
  }, []);

  const ready = width > 0 && !loading;

  return (
    <div ref={containerRef} className="relative h-full w-full">
      {ready && (
        <>
          <GridLayout
            width={width}
            layout={layout}
            onLayoutChange={handleLayoutChange}
            gridConfig={GRID_CONFIG}
            dragConfig={DRAG_CONFIG}
            resizeConfig={RESIZE_CONFIG}
          >
            {pinnedInstances.map((instance) => {
              const def = defById.get(instance.widgetId);
              return (
                <div key={instance.instanceId}>
                  <InstancePanel instance={instance} def={def} />
                </div>
              );
            })}
          </GridLayout>
          <FloatingLayer />
        </>
      )}
    </div>
  );
}
