// Backlinks + forward Links for the hosting pane's note — two collapsible
// sections at the bottom of the editor column (below the document, sharing
// its geometry) rather than a right rail: the workspace is a single centered
// text column with the composer pinned bottom, so a rail would fight both the
// 700px measure and the chat popover. Both panels share the same grouped-list
// shell; only the fetch + grouping key differ (backlinks group by the SOURCE
// note that links in; forward links group by the TARGET the current note
// links out to, which can dangle — no resolved file to open). Entries group
// by note with the linking line as a snippet; click navigates. Refreshes on
// onKnowledgeUpdated (the index lags saves by ~200-300ms, which is fine for a
// reference panel) plus on note switch.

import { useCallback, useEffect, useState } from "react";
import { ChevronRightIcon } from "lucide-react";

import { cn } from "@repo/ui/lib/utils";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@repo/ui/components/collapsible";

import { getBridge } from "@renderer/lib/bridge";
import { useVault } from "@renderer/workspace/vault-context";
import type { BacklinkEntry, ForwardLinkEntry } from "@repo/core/knowledge/link-graph-index";

function noteTitle(path: string): string {
  const name = path.split("/").pop() ?? path;
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

// ---------------------------------------------------------------------------
// Shared grouped-list shell — a group is one note (or, for a dangling forward
// link, one unresolved target) with the source/snippet lines under it.
// `onOpen: null` renders the group unclickable (a dangling target has nothing
// to navigate to).
// ---------------------------------------------------------------------------

type LinkGroup = {
  key: string;
  label: string;
  onOpen: (() => void) | null;
  lines: { key: number; snippet: string }[];
};

function LinkGroupList({ groups }: { groups: LinkGroup[] }) {
  return (
    <div className="mt-2 flex flex-col gap-3 pb-2">
      {groups.map((group) => (
        <div key={group.key}>
          <button
            type="button"
            onClick={group.onOpen ?? undefined}
            disabled={group.onOpen === null}
            title={group.label}
            className={cn(
              "text-sm font-medium text-foreground transition-colors",
              group.onOpen
                ? "cursor-pointer hover:text-primary"
                : "cursor-default text-muted-foreground",
            )}
          >
            {group.label}
          </button>
          <div className="mt-1 flex flex-col gap-1">
            {group.lines.map((line) => (
              <button
                key={line.key}
                type="button"
                onClick={group.onOpen ?? undefined}
                disabled={group.onOpen === null}
                className={cn(
                  "rounded-md bg-muted/40 px-2 py-1 text-left text-xs text-muted-foreground transition-colors",
                  group.onOpen && "cursor-pointer hover:bg-muted hover:text-foreground",
                )}
              >
                <span className="line-clamp-2">{line.snippet}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Backlinks — notes that link INTO this one.
// ---------------------------------------------------------------------------

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
  const groups: LinkGroup[] = [];
  const bySource = new Map<string, LinkGroup>();
  for (const entry of backlinks) {
    let group = bySource.get(entry.sourcePath);
    if (!group) {
      group = {
        key: entry.sourcePath,
        label: noteTitle(entry.sourcePath),
        onOpen: () => openFile(entry.sourcePath),
        lines: [],
      };
      bySource.set(entry.sourcePath, group);
      groups.push(group);
    }
    if (!group.lines.some((line) => line.key === entry.line)) {
      group.lines.push({ key: entry.line, snippet: entry.snippet });
    }
  }

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
        <LinkGroupList groups={groups} />
      </CollapsibleContent>
    </Collapsible>
  );
}

// ---------------------------------------------------------------------------
// Links — this note's OUTGOING links (already visible inline as clickable
// wiki-links in the document; this is the same completed-links story
// Backlinks tells for incoming ones). A dangling target (no resolved file
// yet) groups by its raw text and stays unclickable.
// ---------------------------------------------------------------------------

export function ForwardLinksPanel({ path }: { path: string }) {
  const { openFile } = useVault();
  const [links, setLinks] = useState<ForwardLinkEntry[]>([]);

  const refresh = useCallback((notePath: string) => {
    const bridge = getBridge();
    if (!bridge) return;
    bridge
      .getForwardLinks({ path: notePath })
      .then((entries) => setLinks(entries))
      .catch(() => {});
  }, []);

  useEffect(() => {
    refresh(path);
    const bridge = getBridge();
    return bridge?.onKnowledgeUpdated(() => refresh(path));
  }, [path, refresh]);

  if (links.length === 0) return null;

  // Group by resolved target path, or by the raw target text when the link
  // dangles (no resolved path yet) — several dangling refs to the same
  // not-yet-existing name still group into one row.
  const groups: LinkGroup[] = [];
  const byTarget = new Map<string, LinkGroup>();
  for (const entry of links) {
    const targetPath = entry.targetPath;
    const key = targetPath ?? `dangling:${entry.target}`;
    let group = byTarget.get(key);
    if (!group) {
      group = {
        key,
        label: targetPath !== null ? noteTitle(targetPath) : entry.target,
        onOpen: targetPath !== null ? () => openFile(targetPath) : null,
        lines: [],
      };
      byTarget.set(key, group);
      groups.push(group);
    }
    if (!group.lines.some((line) => line.key === entry.line)) {
      group.lines.push({ key: entry.line, snippet: entry.snippet });
    }
  }

  return (
    <Collapsible defaultOpen className="group/links mt-10 border-t border-border pt-3">
      <CollapsibleTrigger className="flex w-full cursor-pointer items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground">
        <ChevronRightIcon className="size-3.5 transition-transform group-data-[panel-open]/links:rotate-90" />
        <span>Links</span>
        <span className="rounded-full bg-muted px-1.5 py-px text-[10px] tabular-nums">
          {links.length}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <LinkGroupList groups={groups} />
      </CollapsibleContent>
    </Collapsible>
  );
}
