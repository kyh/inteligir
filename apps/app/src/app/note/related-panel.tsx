// Related notes — the notes connected to the open one that do NOT link to it —
// as a collapsible section under the backlinks one, in the same measure.
//
// It sits BESIDE backlinks rather than inside them because the two answer
// different questions and one of the answers is weaker. Backlinks are counted:
// a link either exists in another note's bytes or it does not. This list is
// INFERRED — shared link targets, shared tags, similar text, blended by a
// scorer — so it is offered rather than presented, and starts collapsed where
// backlinks start open.
//
// The REASONS are the reason this ships at all. A ranked list of filenames is
// a claim a reader cannot check, and the failure mode of an inferred list is
// precisely a plausible-looking row that is there by accident; the scorer
// already computes why, in words, so every row carries its own.
//
// Direct neighbours are absent by construction (the scorer excludes them), so
// the section above and this one never name the same note twice.

import type { RelatedNoteWire } from "@repo/server-contract/knowledge";
import { useQuery } from "@tanstack/react-query";
import { queryKeys, unwrap } from "../api";
import { readRelatedOpen, writeRelatedOpen } from "../prefs";
import { useWorkspace } from "../workspace-context";
import {
  NoteFootList,
  NoteFootMessage,
  NoteFootRow,
  NoteFootSection,
  useSectionOpen,
} from "./note-foot-section";

/**
 * A doc's related notes. Swept by `knowledgeRoot` on every content or file
 * change (workspace-context.tsx) rather than re-read on a timer: every signal
 * this ranks on lives in notes other than the open one.
 *
 * Only asked while the section is OPEN, which is where it parts company with
 * backlinks. A backlink read is a graph lookup; this one settles the index and
 * then runs a lexical probe per title token, and the section is collapsed by
 * default — so fetching regardless would re-run the vault's most expensive
 * read on every save, for a list nobody is looking at.
 */
function useRelatedNotes(docPath: string, enabled: boolean) {
  const { api } = useWorkspace();
  return useQuery({
    queryKey: queryKeys.related(docPath),
    queryFn: async () => unwrap(await api.knowledge.related.$get({ query: { path: docPath } })),
    enabled,
  });
}

/** "3 related notes", "1 related note", "No related notes". No truncation
 *  clause: this is a ranked top-N, so there is no honest count of the rest. */
export function relatedSummary(shown: number): string {
  if (shown === 0) {
    return "No related notes";
  }
  return `${shown} related note${shown === 1 ? "" : "s"}`;
}

export interface RelatedPanelProps {
  related: readonly RelatedNoteWire[];
  /** No answer yet — distinct from "answered zero", and from never asked. */
  loading: boolean;
  /** The read refused. A count would be a claim the panel cannot make. */
  failed: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpen: (path: string) => void;
}

export function RelatedPanel({
  related,
  loading,
  failed,
  open,
  onOpenChange,
  onOpen,
}: RelatedPanelProps) {
  const settled = !loading && !failed;
  return (
    <NoteFootSection
      summary={settled ? relatedSummary(related.length) : "Related notes"}
      open={open}
      onOpenChange={onOpenChange}
    >
      {related.length === 0 ? (
        <NoteFootMessage>
          {failed
            ? "Could not read the index just now."
            : loading
              ? "…"
              : "Nothing else in the vault shares this note's links, tags or words."}
        </NoteFootMessage>
      ) : (
        <NoteFootList>
          {related.map((entry) => (
            <NoteFootRow
              key={entry.path}
              label={entry.title}
              path={entry.path}
              detail={entry.reasons.join(" · ")}
              onOpen={() => onOpen(entry.path)}
            />
          ))}
        </NoteFootList>
      )}
    </NoteFootSection>
  );
}

export interface RelatedSectionProps {
  path: string;
  onOpen: (path: string) => void;
}

/** The panel with its own data. Split from the panel so the surface is
 *  testable without a query client, the way the backlinks section is. */
export function RelatedSection({ path, onOpen }: RelatedSectionProps) {
  const [open, setOpen] = useSectionOpen(readRelatedOpen, writeRelatedOpen);
  const relatedQuery = useRelatedNotes(path, open);

  return (
    <RelatedPanel
      related={relatedQuery.data?.related ?? []}
      loading={relatedQuery.isPending}
      failed={relatedQuery.isError}
      open={open}
      onOpenChange={setOpen}
      onOpen={onOpen}
    />
  );
}
