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
import { useQuery } from "@tanstack/react-query";
import { queryKeys, unwrap } from "../api";
import { readBacklinksOpen, writeBacklinksOpen } from "../prefs";
import { useWorkspace } from "../workspace-context";
import {
  NoteFootList,
  NoteFootMessage,
  NoteFootRow,
  NoteFootSection,
  useSectionOpen,
} from "./note-foot-section";

/**
 * A doc's backlinks. Swept by `knowledgeRoot` on every content or file change
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
    <NoteFootSection
      summary={loading ? "Linked mentions" : backlinksSummary(backlinks.length, total)}
      open={open}
      onOpenChange={onOpenChange}
    >
      {backlinks.length === 0 ? (
        <NoteFootMessage>{loading ? "…" : "No other note links here yet."}</NoteFootMessage>
      ) : (
        <NoteFootList>
          {backlinks.map((backlink) => (
            <NoteFootRow
              key={`${backlink.sourcePath}:${backlink.line}`}
              label={backlinkLabel(backlink.sourcePath)}
              path={backlink.sourcePath}
              detail={backlink.snippet}
              onOpen={() => onOpen(backlink.sourcePath)}
            />
          ))}
        </NoteFootList>
      )}
    </NoteFootSection>
  );
}

export interface BacklinksSectionProps {
  path: string;
  onOpen: (path: string) => void;
}

/** The panel with its own data. Split from the panel so the surface is
 *  testable without a query client, the way the proposal surfaces are. */
export function BacklinksSection({ path, onOpen }: BacklinksSectionProps) {
  const [open, setOpen] = useSectionOpen(readBacklinksOpen, writeBacklinksOpen);
  const backlinksQuery = useBacklinks(path);

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
