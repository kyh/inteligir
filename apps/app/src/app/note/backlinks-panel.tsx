// Backlinks — the notes that link INTO the open one — as a collapsible
// section at the FOOT of the document, inside the editor column's own measure.
//
// The placement is the decision. The editor column is this product's centre of
// gravity and the sidebar is the file tree; a third rail would take width from
// the writing surface permanently to show something a reader wants at the end
// of a note, not while typing into one. Below the document it costs nothing
// until you scroll there, it inherits the note's own measure so the two read as
// one page, and it moves with the document rather than hovering over it. A
// palette command was the other candidate and is not enough on its own: you
// have to already suspect a backlink exists to go looking for one, which is
// exactly what a reader does not know.
//
// OUTGOING links are deliberately absent. They are already on screen in the
// document as wiki-links (unresolved ones dashed), so a list of them under the
// note would be the same information twice, one copy of it stale.

import type { BacklinkEntryWire } from "@repo/server-contract/knowledge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@repo/ui/components/collapsible";
import { cn } from "@repo/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { ChevronRightIcon } from "lucide-react";
import { useState } from "react";
import { queryKeys, unwrap } from "../api";
import { readBacklinksOpen, writeBacklinksOpen } from "../prefs";
import { useWorkspace } from "../workspace-context";

/**
 * A doc's backlinks. Swept by `backlinksRoot` on every content or file change
 * (workspace-context.tsx) rather than re-read on a timer: a link into this note
 * is written in another note, so the only thing that knows is the bus.
 */
function useBacklinks(docPath: string) {
  const { api } = useWorkspace();
  return useQuery({
    queryKey: queryKeys.backlinks(docPath),
    queryFn: async () => unwrap(await api.knowledge.backlinks.$get({ query: { path: docPath } })),
  });
}

/** The stem a reader recognises — the file's own name, without the folder or
 *  the extension, with the full path as the row's title. */
export function backlinkLabel(sourcePath: string): string {
  const name = sourcePath.slice(sourcePath.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

/** "3 linked mentions", "1 linked mention", "No linked mentions" — and the
 *  truncation stated rather than implied when the vault holds more than the
 *  route's cap. */
export function backlinksSummary(shown: number, total: number): string {
  if (total === 0) {
    return "No linked mentions";
  }
  const counted = `${total} linked mention${total === 1 ? "" : "s"}`;
  return shown < total ? `${counted} (${shown} shown)` : counted;
}

export interface BacklinksPanelProps {
  backlinks: readonly BacklinkEntryWire[];
  total: number;
  /** The query has not answered yet — distinct from "answered zero". */
  loading: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpen: (path: string) => void;
}

export function BacklinksPanel({
  backlinks,
  total,
  loading,
  open,
  onOpenChange,
  onOpen,
}: BacklinksPanelProps) {
  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <CollapsibleTrigger className="flex w-full items-center gap-1.5 py-2 text-xs font-medium tracking-wide text-muted-foreground hover:text-foreground">
        <ChevronRightIcon
          className={cn("size-3.5 transition-transform", open && "rotate-90")}
          aria-hidden
        />
        {loading ? "Linked mentions" : backlinksSummary(backlinks.length, total)}
      </CollapsibleTrigger>
      <CollapsibleContent>
        {backlinks.length === 0 ? (
          <p className="pb-4 text-sm text-muted-foreground">
            {loading ? "…" : "No other note links here yet."}
          </p>
        ) : (
          <ul className="space-y-1 pb-4">
            {backlinks.map((backlink) => (
              <li key={`${backlink.sourcePath}:${backlink.line}`}>
                <button
                  type="button"
                  className="w-full rounded-md px-2 py-1.5 text-left hover:bg-muted"
                  onClick={() => onOpen(backlink.sourcePath)}
                >
                  <span className="block truncate text-sm" title={backlink.sourcePath}>
                    {backlinkLabel(backlink.sourcePath)}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {backlink.snippet}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

export interface BacklinksSectionProps {
  path: string;
  onOpen: (path: string) => void;
}

/** The panel with its own data. Split from the panel so the surface is
 *  testable without a query client, the way the proposal surfaces are. */
export function BacklinksSection({ path, onOpen }: BacklinksSectionProps) {
  const [open, setOpenState] = useState(readBacklinksOpen);
  const backlinksQuery = useBacklinks(path);
  const setOpen = (next: boolean): void => {
    writeBacklinksOpen(next);
    setOpenState(next);
  };

  return (
    <BacklinksPanel
      backlinks={backlinksQuery.data?.backlinks ?? []}
      total={backlinksQuery.data?.total ?? 0}
      loading={backlinksQuery.data === undefined}
      open={open}
      onOpenChange={setOpen}
      onOpen={onOpen}
    />
  );
}
