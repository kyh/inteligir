// The workspace tab strip — one tab per open note, VS Code conventions:
// click activates, Cmd/Ctrl-click in the sidebar opens a new tab, middle-click
// closes, closing a dirty tab flushes first (vault-context owns that), and the
// dirty dot swaps to an X on hover.

import { useCallback, useSyncExternalStore, type MouseEvent } from "react";
import { XIcon } from "lucide-react";

import { cn } from "@repo/ui/lib/utils";

import { useVault } from "@repo/app/workspace/vault-context";

function tabLabel(path: string): string {
  const name = path.split("/").pop() ?? path;
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

function TabItem({ path }: { path: string }) {
  const { activeTab, activateTab, closeTab, subscribeTab, isTabDirty } = useVault();
  const subscribe = useCallback(
    (listener: () => void) => subscribeTab(path, listener),
    [subscribeTab, path],
  );
  const dirty = useSyncExternalStore(subscribe, () => isTabDirty(path));
  const active = activeTab === path;

  const onAuxClick = (e: MouseEvent) => {
    if (e.button === 1) {
      e.preventDefault();
      closeTab(path);
    }
  };

  return (
    <div
      role="tab"
      aria-selected={active}
      title={path}
      onClick={() => activateTab(path)}
      onAuxClick={onAuxClick}
      className={cn(
        "group flex h-full min-w-0 max-w-48 shrink-0 cursor-pointer select-none items-center gap-1.5 border-r border-border px-3 text-xs transition-colors",
        active
          ? "bg-background text-foreground shadow-[inset_0_-2px_0_0_var(--primary)]"
          : "bg-sidebar text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      <span className="truncate">{tabLabel(path)}</span>
      <button
        type="button"
        aria-label={dirty ? `Close ${path} (unsaved changes)` : `Close ${path}`}
        onClick={(e) => {
          e.stopPropagation();
          closeTab(path);
        }}
        className={cn(
          "relative flex size-4 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-border hover:text-foreground",
        )}
      >
        {/* Dirty dot by default, X on tab hover — VS Code's affordance. A
         * clean tab reserves the same box so labels don't shift on hover. */}
        <span
          className={cn(
            "size-2 rounded-full bg-foreground/70 group-hover:hidden",
            dirty ? "block" : "hidden",
          )}
        />
        <XIcon
          className={cn(
            "size-3.5",
            dirty ? "hidden group-hover:block" : "invisible group-hover:visible",
          )}
        />
      </button>
    </div>
  );
}

export function TabStrip() {
  const { tabs } = useVault();
  if (tabs.length === 0) return null;

  return (
    <div
      role="tablist"
      aria-label="Open notes"
      className="flex h-9 shrink-0 items-end overflow-x-auto border-b border-border bg-sidebar"
    >
      <div className="flex h-full">
        {tabs.map((path) => (
          <TabItem key={path} path={path} />
        ))}
      </div>
    </div>
  );
}
