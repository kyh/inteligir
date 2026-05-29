import { useCallback, useEffect, useMemo } from "react";
import { Maximize2Icon, PlusIcon, XIcon } from "lucide-react";
import {
  GridLayout,
  useContainerWidth,
  type Layout,
  type LayoutItem,
} from "react-grid-layout";
import "react-grid-layout/css/styles.css";

import { cn } from "@repo/ui/lib/utils";

import { FloatingLayer } from "@/renderer/chat/floating-layer";
import {
  closeInstance,
  isPermanentInstance,
  WidgetBody,
  widgetBodyClassName,
  widgetTitle,
} from "@/renderer/chat/widget-render";
import { getBridge } from "@/renderer/lib/bridge";
import { initShell, useShellStore } from "@/renderer/stores/shell-store";
import {
  type CustomWidgetDef,
  type GenerateWidgetInput,
  type WidgetGeometry,
  type WidgetInstance,
} from "@/shared/shell";

// ---------------------------------------------------------------------------
// Reshapeable workspace ("shell")
//
// A 12-column grid of placed "desktop widget" instances (surface === "pinned").
// Floating "app window" instances render above it via FloatingLayer. Each
// instance owns its grid geometry; the chat instance is permanent. Panels can
// be popped out to a window or closed.
// ---------------------------------------------------------------------------

const GRID_CONFIG = { cols: 12, rowHeight: 46, margin: [10, 10], containerPadding: [0, 0] } as const;
const DRAG_CONFIG = { enabled: true, bounded: false, handle: ".panel-drag-handle" } as const;
const RESIZE_CONFIG = { enabled: true, handles: ["se", "e", "s"] } as const;

function instanceToLayoutItem(i: WidgetInstance): LayoutItem {
  return { i: i.instanceId, ...i.geometry };
}

function geometryFromLayoutItem(item: LayoutItem): WidgetGeometry {
  const geo: WidgetGeometry = { x: item.x, y: item.y, w: item.w, h: item.h };
  if (item.minW !== undefined) geo.minW = item.minW;
  if (item.minH !== undefined) geo.minH = item.minH;
  return geo;
}

// A blank, user-editable note — the simplest custom widget a user can add
// without authoring a spec: a multi-line field bound to state.
function noteStarter(): GenerateWidgetInput {
  return {
    title: "Note",
    spec: {
      root: "root",
      elements: {
        root: { type: "Stack", props: { gap: "sm" }, children: ["body"] },
        body: {
          type: "Textarea",
          props: { placeholder: "Type a note…", value: { $bindState: "/text" }, rows: 6 },
        },
      },
      state: { text: "" },
    },
    state: { text: "" },
  };
}

// ---------------------------------------------------------------------------
// Panel chrome
// ---------------------------------------------------------------------------

function Panel({
  title,
  children,
  bodyClassName,
  onPopOut,
  onRemove,
}: {
  title: React.ReactNode;
  children: React.ReactNode;
  bodyClassName?: string;
  onPopOut?: () => void;
  onRemove?: () => void;
}) {
  return (
    <div className="flex h-full w-full flex-col overflow-hidden rounded-xl border border-border bg-card/40 shadow-lg backdrop-blur-md">
      <div className="panel-drag-handle flex shrink-0 cursor-move items-center justify-between gap-2 border-b border-border/60 px-3 py-2">
        <span className="truncate text-xs font-medium text-muted-foreground">{title}</span>
        <div className="flex shrink-0 items-center gap-0.5">
          {onPopOut ? (
            <PanelButton label="Pop out to window" onClick={onPopOut}>
              <Maximize2Icon className="size-3.5" />
            </PanelButton>
          ) : null}
          {onRemove ? (
            <PanelButton label="Close panel" onClick={onRemove}>
              <XIcon className="size-3.5" />
            </PanelButton>
          ) : null}
        </div>
      </div>
      <div className={cn("min-h-0 flex-1 overflow-auto", bodyClassName)}>{children}</div>
    </div>
  );
}

function PanelButton({
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
      // Stop the grid drag handler from swallowing the click.
      onMouseDown={(e) => e.stopPropagation()}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function InstancePanel({
  instance,
  customDef,
}: {
  instance: WidgetInstance;
  customDef: CustomWidgetDef | undefined;
}) {
  const permanent = isPermanentInstance(instance);
  return (
    <Panel
      title={widgetTitle(instance, customDef)}
      bodyClassName={widgetBodyClassName(instance)}
      onPopOut={() => void getBridge()?.setInstanceSurface(instance.instanceId, "floating")}
      onRemove={permanent ? undefined : () => closeInstance(instance)}
    >
      <WidgetBody instance={instance} customDef={customDef} />
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Grid
// ---------------------------------------------------------------------------

export function PanelGrid() {
  const { width, containerRef } = useContainerWidth();

  useEffect(() => {
    initShell();
  }, []);
  const instances = useShellStore((s) => s.instances);
  const customWidgets = useShellStore((s) => s.customWidgets);
  const loading = useShellStore((s) => s.loading);

  const pinnedInstances = useMemo(() => instances.filter((i) => i.surface === "pinned"), [instances]);
  const layout = useMemo(() => pinnedInstances.map(instanceToLayoutItem), [pinnedInstances]);
  const customById = useMemo(
    () => new Map(customWidgets.map((d) => [d.id, d])),
    [customWidgets],
  );

  // Persist geometry on drag/resize. Main compares against stored geometry and
  // only broadcasts on a real change, so the mount-time callback is a no-op.
  const handleLayoutChange = useCallback((next: Layout) => {
    const geometries: Record<string, WidgetGeometry> = {};
    for (const item of next) geometries[item.i] = geometryFromLayoutItem(item);
    void getBridge()?.setInstanceGeometry(geometries);
  }, []);

  const addNote = useCallback(() => {
    void getBridge()?.generateWidget(noteStarter());
  }, []);

  const ready = width > 0 && !loading;

  return (
    <div ref={containerRef} className="relative h-full w-full">
      {ready && (
        <>
          <button
            type="button"
            onClick={addNote}
            className="absolute right-1 top-0 z-20 flex items-center gap-1 rounded-md border border-border bg-card/60 px-2 py-1 text-xs text-muted-foreground shadow-sm backdrop-blur-md hover:text-foreground"
          >
            <PlusIcon className="size-3.5" />
            Add note
          </button>
          <GridLayout
            width={width}
            layout={layout}
            onLayoutChange={handleLayoutChange}
            gridConfig={GRID_CONFIG}
            dragConfig={DRAG_CONFIG}
            resizeConfig={RESIZE_CONFIG}
          >
            {pinnedInstances.map((instance) => (
              <div key={instance.instanceId}>
                <InstancePanel instance={instance} customDef={customById.get(instance.widgetId)} />
              </div>
            ))}
          </GridLayout>
          <FloatingLayer />
        </>
      )}
    </div>
  );
}
