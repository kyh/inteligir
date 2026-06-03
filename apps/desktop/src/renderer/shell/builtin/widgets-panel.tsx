import { useMemo } from "react";
import { PlayIcon, Trash2Icon } from "lucide-react";

import { toast } from "@repo/ui/components/sonner";

import { getBridge } from "@/renderer/lib/bridge";
import { useShellStore } from "@/renderer/stores/shell-store";
import { isJsonUi, type JsonUiWidgetDef } from "@/shared/shell";

function launch(def: JsonUiWidgetDef): void {
  getBridge()
    ?.placeWidget({ widgetId: def.id, surface: "pinned" })
    .catch((err) => {
      toast.error(err instanceof Error ? err.message : "Couldn't launch the widget");
    });
}

function remove(def: JsonUiWidgetDef): void {
  getBridge()
    ?.deleteWidget({ widgetId: def.id, expectedRevision: def.revision })
    .catch((err) => {
      toast.error(err instanceof Error ? err.message : "Couldn't delete the widget");
    });
}

export function WidgetsPanel() {
  const defs = useShellStore((s) => s.defs);
  const instances = useShellStore((s) => s.instances);
  const customs = useMemo(() => defs.filter(isJsonUi), [defs]);
  const placed = useMemo(() => {
    const ids = new Set<string>();
    for (const i of instances) ids.add(i.widgetId);
    return ids;
  }, [instances]);

  if (customs.length === 0) {
    return (
      <div className="p-3 text-xs text-muted-foreground">
        No custom widgets installed. The agent can add them via its UI tools.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5 p-3">
      {customs.map((def) => (
        <div
          key={def.id}
          className="flex items-center gap-2 rounded-md border border-border px-3 py-2"
        >
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-xs text-foreground">{def.title}</span>
            {def.description && (
              <span className="line-clamp-2 text-[10px] text-muted-foreground">
                {def.description}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={() => launch(def)}
            disabled={placed.has(def.id)}
            title={placed.has(def.id) ? "Already on the grid" : "Place on the grid"}
            aria-label="Place on the grid"
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-foreground/10 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
          >
            <PlayIcon className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={() => remove(def)}
            title="Delete widget"
            aria-label="Delete widget"
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          >
            <Trash2Icon className="size-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
