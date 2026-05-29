import { useCallback, useEffect, useMemo } from "react";
import { PlusIcon, XIcon } from "lucide-react";
import {
  GridLayout,
  useContainerWidth,
  type Layout,
  type LayoutItem,
} from "react-grid-layout";
import "react-grid-layout/css/styles.css";

import { cn } from "@repo/ui/lib/utils";

import { BUILTIN_WIDGET_UI } from "@/renderer/chat/builtin-widgets";
import { WidgetViewer } from "@/renderer/chat/widget-viewer";
import { getBridge } from "@/renderer/lib/bridge";
import { initShell, useShellStore } from "@/renderer/stores/shell-store";
import {
  builtinMeta,
  type CustomWidgetDef,
  type GenerateWidgetInput,
  type WidgetGeometry,
  type WidgetInstance,
} from "@/shared/shell";

// ---------------------------------------------------------------------------
// Reshapeable workspace ("shell")
//
// A 12-column grid of placed widget instances. Each instance owns its grid
// geometry (persisted in shell.json), so the layout survives reloads. The chat
// instance is permanent. Built-in instances close back to the dock (unplace);
// custom instances delete their definition.
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
  onRemove,
}: {
  title: React.ReactNode;
  children: React.ReactNode;
  bodyClassName?: string;
  onRemove?: () => void;
}) {
  return (
    <div className="flex h-full w-full flex-col overflow-hidden rounded-xl border border-border bg-card/40 shadow-lg backdrop-blur-md">
      <div className="panel-drag-handle flex shrink-0 cursor-move items-center justify-between gap-2 border-b border-border/60 px-3 py-2">
        <span className="truncate text-xs font-medium text-muted-foreground">{title}</span>
        {onRemove ? (
          <button
            type="button"
            aria-label="Close panel"
            className="shrink-0 rounded p-0.5 text-muted-foreground/60 hover:bg-muted hover:text-foreground"
            // Stop the grid drag handler from swallowing the click.
            onMouseDown={(e) => e.stopPropagation()}
            onClick={onRemove}
          >
            <XIcon className="size-3.5" />
          </button>
        ) : null}
      </div>
      <div className={cn("min-h-0 flex-1 overflow-auto", bodyClassName)}>{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Instance rendering
// ---------------------------------------------------------------------------

function InstancePanel({
  instance,
  customDef,
}: {
  instance: WidgetInstance;
  customDef: CustomWidgetDef | undefined;
}) {
  const meta = builtinMeta(instance.widgetId);

  if (meta) {
    const ui = BUILTIN_WIDGET_UI[meta.id];
    const Body = ui.component;
    return (
      <Panel
        title={meta.title}
        bodyClassName={ui.bodyClassName}
        // Built-in instances hide back to the dock; the permanent chat can't.
        onRemove={meta.permanent ? undefined : () => void getBridge()?.unplaceWidget(instance.instanceId)}
      >
        <Body />
      </Panel>
    );
  }

  if (!customDef) {
    return (
      <Panel title={instance.widgetId}>
        <div className="p-3 text-xs text-muted-foreground">This widget is unavailable.</div>
      </Panel>
    );
  }

  return (
    <Panel
      title={customDef.title}
      // Closing a custom instance deletes its definition (no dock gallery to
      // re-place it from); the agent manages extra instances via place/unplace.
      onRemove={() => void getBridge()?.deleteWidget(customDef.id)}
    >
      <WidgetViewer instance={instance} spec={customDef.spec} />
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

  const layout = useMemo(() => instances.map(instanceToLayoutItem), [instances]);
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
        <button
          type="button"
          onClick={addNote}
          className="absolute right-1 top-0 z-10 flex items-center gap-1 rounded-md border border-border bg-card/60 px-2 py-1 text-xs text-muted-foreground shadow-sm backdrop-blur-md hover:text-foreground"
        >
          <PlusIcon className="size-3.5" />
          Add note
        </button>
      )}
      {ready && (
        <GridLayout
          width={width}
          layout={layout}
          onLayoutChange={handleLayoutChange}
          gridConfig={GRID_CONFIG}
          dragConfig={DRAG_CONFIG}
          resizeConfig={RESIZE_CONFIG}
        >
          {instances.map((instance) => (
            <div key={instance.instanceId}>
              <InstancePanel instance={instance} customDef={customById.get(instance.widgetId)} />
            </div>
          ))}
        </GridLayout>
      )}
    </div>
  );
}
