import { useCallback, useEffect, useRef, useState } from "react";
import { Checkbox } from "@repo/ui/components/checkbox";
import { Label } from "@repo/ui/components/label";

import { getBridge } from "@/renderer/lib/bridge";
import { useAgentStore } from "@/renderer/stores/agent-store";
import type { ExtensionToolInfo } from "@/shared/ipc";

// Group tools by their source so the dock shows "(core) read, bash, edit, ...",
// "(manage_tasks) manage_tasks", "(browser) browser", etc.
function groupBySource(
  tools: ExtensionToolInfo[],
): Map<string, ExtensionToolInfo[]> {
  const groups = new Map<string, ExtensionToolInfo[]>();
  for (const tool of tools) {
    const list = groups.get(tool.source) ?? [];
    list.push(tool);
    groups.set(tool.source, list);
  }
  return groups;
}

export function ExtensionsPanel() {
  const appState = useAgentStore((s) => s.appState);
  const [tools, setTools] = useState<ExtensionToolInfo[] | null>(null);
  // Mirror of `tools` so toggleTool can read the latest synchronously without
  // closing over stale state and without performing side effects inside a
  // setState updater (which React allows to run twice in StrictMode or defer
  // to the render phase).
  const toolsRef = useRef<ExtensionToolInfo[] | null>(null);

  const applyTools = useCallback((next: ExtensionToolInfo[] | null) => {
    toolsRef.current = next;
    setTools(next);
  }, []);

  const refresh = useCallback(() => {
    const bridge = getBridge();
    if (!bridge) return;
    void bridge
      .listExtensions()
      .then((list) => applyTools(list.tools))
      .catch(() => applyTools([]));
  }, [applyTools]);

  // Refetch whenever the agent transitions to ready — that's when the tool
  // registry first becomes populated. Also refetch on every panel mount.
  useEffect(() => {
    if (appState.phase !== "ready") {
      applyTools(null);
      return;
    }
    refresh();
  }, [appState.phase, refresh, applyTools]);

  const toggleTool = useCallback(
    (name: string, nextActive: boolean) => {
      const current = toolsRef.current;
      if (!current) return;

      // Optimistic update: compute next state synchronously from the ref so
      // rapid back-to-back toggles compose against the latest snapshot.
      const next = current.map((t) =>
        t.name === name ? { ...t, active: nextActive } : t,
      );
      applyTools(next);

      const nextActiveNames = next.filter((t) => t.active).map((t) => t.name);

      // Fire-and-forget. We don't apply the IPC response — the response from
      // an in-flight call would otherwise clobber a more-recent optimistic
      // toggle, causing visible flicker. pi-coding-agent silently ignores
      // unknown tool names, so the names we send (all from a prior list)
      // can only fail by being dropped silently — local state stays correct.
      void getBridge()
        ?.setActiveExtensions(nextActiveNames)
        .catch((err) => {
          console.warn("[extensions] setActiveExtensions failed:", err);
        });
    },
    [applyTools],
  );

  if (appState.phase !== "ready") {
    return (
      <div className="p-3 text-xs text-muted-foreground">
        Extensions will appear once the agent is ready.
      </div>
    );
  }

  if (tools === null) {
    return <div className="p-3 text-xs text-muted-foreground">Loading…</div>;
  }

  if (tools.length === 0) {
    return (
      <div className="p-3 text-xs text-muted-foreground">
        No tools registered.
      </div>
    );
  }

  const groups = groupBySource(tools);

  return (
    <div className="flex flex-col gap-3 p-3">
      {[...groups.entries()].map(([source, items]) => (
        <div key={source} className="flex flex-col gap-1.5">
          <Label className="text-xs font-medium text-muted-foreground">
            {source}
          </Label>
          {items.map((tool) => (
            <label
              key={tool.name}
              className="flex cursor-pointer items-start gap-2 rounded-md border border-border px-3 py-2"
              title={tool.description}
            >
              <Checkbox
                checked={tool.active}
                onCheckedChange={(checked) => {
                  toggleTool(tool.name, checked === true);
                }}
                className="mt-0.5"
              />
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-xs text-foreground">
                  {tool.name}
                </span>
                {tool.description && (
                  <span className="line-clamp-2 text-[10px] text-muted-foreground">
                    {tool.description}
                  </span>
                )}
              </div>
            </label>
          ))}
        </div>
      ))}
    </div>
  );
}
