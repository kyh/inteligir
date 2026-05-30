import { useMemo } from "react";

import { FloatingWindow } from "@/renderer/shell/floating-window";
import {
  closeInstance,
  isPermanentInstance,
  WidgetBody,
  widgetBodyClassName,
  widgetTitle,
} from "@/renderer/shell/widget-render";
import { getBridge } from "@/renderer/lib/bridge";
import { useShellStore } from "@/renderer/stores/shell-store";
import { isFloating, type FloatRect } from "@/shared/shell";

// Renders floating ("app window") instances above the grid. Click-through
// everywhere except the windows themselves.
export function FloatingLayer() {
  const instances = useShellStore((s) => s.instances);
  const customWidgets = useShellStore((s) => s.customWidgets);
  const floating = useMemo(() => instances.filter(isFloating), [instances]);
  const customById = useMemo(
    () => new Map(customWidgets.map((d) => [d.id, d])),
    [customWidgets],
  );

  if (floating.length === 0) return null;

  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      {floating.map((instance) => {
        const customDef = customById.get(instance.widgetId);
        const permanent = isPermanentInstance(instance);
        return (
          <FloatingWindow
            key={instance.instanceId}
            title={widgetTitle(instance, customDef)}
            rect={instance.placement.rect}
            z={instance.placement.z}
            bodyClassName={widgetBodyClassName(instance)}
            onFocus={() => void getBridge()?.focusInstance(instance.instanceId)}
            onRect={(rect: FloatRect) => void getBridge()?.setInstanceRect(instance.instanceId, rect)}
            onDock={() => void getBridge()?.setInstanceSurface(instance.instanceId, "pinned")}
            onClose={permanent ? undefined : () => closeInstance(instance)}
          >
            <WidgetBody instance={instance} customDef={customDef} />
          </FloatingWindow>
        );
      })}
    </div>
  );
}
