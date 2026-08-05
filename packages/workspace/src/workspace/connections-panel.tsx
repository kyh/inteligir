// Connections — the notes that link INTO the hosting pane's note: one
// collapsible section at the bottom of the editor column (below the document,
// sharing its geometry) rather than a right rail, because the workspace is a
// single centered text column with the composer pinned bottom and a rail would
// fight both the 700px measure and the chat popover. Occurrences group by the
// source note with the linking line as a snippet; click navigates. Refreshes
// on onKnowledgeUpdated (the index lags saves by ~200-300ms, which is fine for
// a reference panel) plus on note switch.
//
// Only INBOUND, deliberately. This note's own outgoing links are already on
// screen above — resolved ones as chips that navigate, unresolved ones dashed
// with a create affordance (wiki-chip.tsx), with the counts in Page details —
// so restating them below the document is a list of what the reader can see.

import { useCallback, useEffect, useState } from "react";
import { ChevronRightIcon } from "lucide-react";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@repo/ui/components/collapsible";

import { getBridge } from "@repo/bridge/client";
import { useVaultActions } from "@repo/editor/host";
import type { BacklinkEntry } from "@repo/notes/knowledge/link-graph-index";
import { basenamePath } from "@repo/notes/knowledge/vault-path";

function noteTitle(path: string): string {
  const name = basenamePath(path);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

/** One linking note plus the lines it links from. */
type LinkGroup = {
  path: string;
  label: string;
  lines: { key: number; snippet: string }[];
};

export function ConnectionsPanel({ path }: { path: string }) {
  const { openFile } = useVaultActions();
  const [backlinks, setBacklinks] = useState<BacklinkEntry[]>([]);

  const refresh = useCallback((notePath: string) => {
    getBridge()
      .getBacklinks({ path: notePath })
      .then((entries) => setBacklinks(entries))
      .catch(() => {});
  }, []);

  useEffect(() => {
    refresh(path);
    return getBridge().onKnowledgeUpdated(() => refresh(path));
  }, [path, refresh]);

  if (backlinks.length === 0) return null;

  // Group occurrences by source note (index order preserved), one row per
  // source LINE — two links on the same line share a snippet and a target.
  const groups: LinkGroup[] = [];
  const bySource = new Map<string, LinkGroup>();
  for (const entry of backlinks) {
    let group = bySource.get(entry.sourcePath);
    if (!group) {
      group = { label: noteTitle(entry.sourcePath), lines: [], path: entry.sourcePath };
      bySource.set(entry.sourcePath, group);
      groups.push(group);
    }
    if (!group.lines.some((line) => line.key === entry.line)) {
      group.lines.push({ key: entry.line, snippet: entry.snippet });
    }
  }

  return (
    <Collapsible defaultOpen className="group/connections mt-10 border-t border-border pt-3">
      <CollapsibleTrigger className="flex w-full cursor-pointer items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground">
        <ChevronRightIcon className="size-3.5 transition-transform group-data-[panel-open]/connections:rotate-90" />
        <span>Connections</span>
        <span className="rounded-full bg-muted px-1.5 py-px text-[10px] tabular-nums">
          {backlinks.length}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-2 flex flex-col gap-3 pb-2">
          {groups.map((group) => (
            <div key={group.path}>
              <button
                type="button"
                onClick={() => openFile(group.path)}
                title={group.path}
                className="cursor-pointer text-sm font-medium text-foreground transition-colors hover:text-primary"
              >
                {group.label}
              </button>
              <div className="mt-1 flex flex-col gap-1">
                {group.lines.map((line) => (
                  <button
                    key={line.key}
                    type="button"
                    onClick={() => openFile(group.path)}
                    className="cursor-pointer rounded-md bg-muted/40 px-2 py-1 text-left text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <span className="line-clamp-2">{line.snippet}</span>
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
