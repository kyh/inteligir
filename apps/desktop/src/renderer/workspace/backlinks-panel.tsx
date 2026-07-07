// Backlinks for the hosting pane's note — a collapsible section at the bottom
// of the editor column (below the document, sharing its geometry) rather than a
// right rail: the workspace is a single centered text column with the
// composer pinned bottom, so a rail would fight both the 700px measure and
// the chat popover. Entries group by source note with the linking line as a
// snippet; click navigates. Refreshes on onKnowledgeUpdated (the index lags
// saves by ~200-300ms, which is fine for a reference panel) plus on note
// switch.

import { useCallback, useEffect, useState } from "react";
import { ChevronRightIcon } from "lucide-react";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@repo/ui/components/collapsible";

import { getBridge } from "@renderer/lib/bridge";
import { useVault } from "@renderer/workspace/vault-context";
import type { BacklinkEntry } from "@repo/core/knowledge/knowledge-index";

function noteTitle(path: string): string {
  const name = path.split("/").pop() ?? path;
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

export function BacklinksPanel({ path }: { path: string }) {
  const { openFile } = useVault();
  const [backlinks, setBacklinks] = useState<BacklinkEntry[]>([]);

  const refresh = useCallback((notePath: string) => {
    const bridge = getBridge();
    if (!bridge) return;
    bridge
      .getBacklinks({ path: notePath })
      .then((entries) => setBacklinks(entries))
      .catch(() => {});
  }, []);

  useEffect(() => {
    refresh(path);
    const bridge = getBridge();
    return bridge?.onKnowledgeUpdated(() => refresh(path));
  }, [path, refresh]);

  if (backlinks.length === 0) return null;

  // Group occurrences by source note (index order preserved), one row per
  // source LINE — two links on the same line share a snippet and a target.
  const groups = new Map<string, Map<number, BacklinkEntry>>();
  for (const entry of backlinks) {
    const lines = groups.get(entry.sourcePath) ?? new Map<number, BacklinkEntry>();
    if (!lines.has(entry.line)) lines.set(entry.line, entry);
    groups.set(entry.sourcePath, lines);
  }

  const open = (source: string) => () => {
    openFile(source);
  };

  return (
    <Collapsible defaultOpen className="group/backlinks mt-10 border-t border-border pt-3">
      <CollapsibleTrigger className="flex w-full cursor-pointer items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground">
        <ChevronRightIcon className="size-3.5 transition-transform group-data-[panel-open]/backlinks:rotate-90" />
        <span>Backlinks</span>
        <span className="rounded-full bg-muted px-1.5 py-px text-[10px] tabular-nums">
          {backlinks.length}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-2 flex flex-col gap-3 pb-2">
          {[...groups.entries()].map(([source, entries]) => (
            <div key={source}>
              <button
                type="button"
                onClick={open(source)}
                title={source}
                className="cursor-pointer text-sm font-medium text-foreground transition-colors hover:text-primary"
              >
                {noteTitle(source)}
              </button>
              <div className="mt-1 flex flex-col gap-1">
                {[...entries.values()].map((entry) => (
                  <button
                    key={entry.line}
                    type="button"
                    onClick={open(source)}
                    className="cursor-pointer rounded-md bg-muted/40 px-2 py-1 text-left text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <span className="line-clamp-2">{entry.snippet}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
