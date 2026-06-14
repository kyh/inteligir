import { useMemo } from "react";

import { FloatingWindow } from "@/renderer/shell/floating-window";
import {
  closeInstance,
  moveInstance,
  WidgetBody,
  widgetBodyClassName,
  widgetIcon,
  widgetTitle,
} from "@/renderer/shell/widget-render";
import { getBridge } from "@/renderer/lib/bridge";
import { useShellStore } from "@/renderer/stores/shell-store";
import { isFloating, type FloatRect } from "@/shared/shell";

// Renders floating ("app window") instances above the grid. Click-through
// everywhere except the windows themselves.
export function FloatingLayer() {
  const instances = useShellStore((s) => s.instances);
  const defs = useShellStore((s) => s.defs);
  const floating = useMemo(() => instances.filter(isFloating), [instances]);
  const defById = useMemo(() => new Map(defs.map((d) => [d.id, d])), [defs]);

  if (floating.length === 0) return null;

  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      {floating.map((instance) => {
        const def = defById.get(instance.widgetId);
        return (
          <FloatingWindow
            key={instance.instanceId}
            icon={widgetIcon(def)}
            title={widgetTitle(def, instance)}
            rect={instance.placement.rect}
            z={instance.placement.z}
            bodyClassName={widgetBodyClassName(def)}
            onFocus={() => void getBridge()?.focusInstance(instance.instanceId)}
            onRect={(rect: FloatRect) =>
              void getBridge()?.setInstanceRect({ instanceId: instance.instanceId, rect })
            }
            onDock={() => void moveInstance(instance.instanceId, "pinned")}
            onClose={() => void closeInstance(instance)}
          >
            <WidgetBody def={def} instance={instance} />
          </FloatingWindow>
        );
      })}
    </div>
  );
}
