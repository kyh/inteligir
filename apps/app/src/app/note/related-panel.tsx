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
import { readRelatedOpen, writeRelatedOpen } from "../prefs";
import { useWorkspace } from "../workspace-context";

/**
 * A doc's related notes. Swept by `relatedRoot` on every content or file
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
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <CollapsibleTrigger className="flex w-full items-center gap-1.5 py-2 text-xs font-medium tracking-wide text-muted-foreground hover:text-foreground">
        <ChevronRightIcon
          className={cn("size-3.5 transition-transform", open && "rotate-90")}
          aria-hidden
        />
        {settled ? relatedSummary(related.length) : "Related notes"}
      </CollapsibleTrigger>
      <CollapsibleContent>
        {related.length === 0 ? (
          <p className="pb-4 text-sm text-muted-foreground">
            {failed
              ? "Could not read the index just now."
              : loading
                ? "…"
                : "Nothing else in the vault shares this note's links, tags or words."}
          </p>
        ) : (
          <ul className="space-y-1 pb-4">
            {related.map((entry) => (
              <li key={entry.path}>
                <button
                  type="button"
                  className="w-full rounded-md px-2 py-1.5 text-left hover:bg-muted"
                  onClick={() => onOpen(entry.path)}
                >
                  <span className="block truncate text-sm" title={entry.path}>
                    {entry.title}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {entry.reasons.join(" · ")}
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

export interface RelatedSectionProps {
  path: string;
  onOpen: (path: string) => void;
}

/** The panel with its own data. Split from the panel so the surface is
 *  testable without a query client, the way the backlinks section is. */
export function RelatedSection({ path, onOpen }: RelatedSectionProps) {
  const [open, setOpenState] = useState(readRelatedOpen);
  const relatedQuery = useRelatedNotes(path, open);
  const setOpen = (next: boolean): void => {
    writeRelatedOpen(next);
    setOpenState(next);
  };

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
