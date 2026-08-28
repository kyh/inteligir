// Related — the notes connected to the open one — as one collapsible section
// in the right panel, below Properties (the owner's 2026-08-22 placement,
// reversing the under-document foot sections; CLAUDE.md records it).
//
// One list, two kinds of row, and the DETAIL line is what keeps them honest:
// linked mentions are counted facts and lead the list carrying "Links here"
// plus the linking sentence; the scorer's suggestions follow carrying their
// own reasons, because a ranked filename with no reason is a claim a reader
// cannot check. No dedup is needed between the halves — the scorer excludes
// direct neighbours by construction, so the same note never appears twice.

import { docStem } from "@repo/notes/knowledge/doc-file";
import { isUuidWikiAlias } from "@repo/notes/markdown/remark-wiki-link";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@repo/ui/lib/utils";
import { ChevronRightIcon } from "lucide-react";
import { useState } from "react";

import { orpc } from "../api";
import { readRelatedOpen, writeRelatedOpen } from "../prefs";

/** One row of the merged list, whichever half it came from. */
export interface RelatedRow {
  path: string;
  label: string;
  /** Why this row is here — "Links here · <snippet>" or the scorer's reasons. */
  detail: string;
}

/** A backlink SNIPPET is the linking sentence verbatim, so it still carries
 *  the dialect's own syntax. The panel wants prose: render what a reader sees
 *  in the source note, not the bytes that produce it. */
export function plainSnippet(snippet: string): string {
  return snippet
    .replace(/!?\[\[([^\]]+)\]\]/gu, (_match, body: string) => {
      const parts = body.split("|");
      const target = parts[0] ?? body;
      const alias = parts.length > 1 ? parts.at(-1) : undefined;
      // A uuid alias is IDENTITY, not a label — the same rule the chip reads.
      const label = alias !== undefined && !isUuidWikiAlias(alias) ? alias : target;
      return label.split("#")[0] ?? label;
    })
    .replace(/\{\{([^{}]*)\}\}/gu, (_match, body: string) => body.split("|")[1] ?? "")
    .replace(/%%i:[^%]*%%/gu, "")
    .replace(/^[\s>#*-]+/u, "")
    .replace(/\s+/gu, " ")
    .trim();
}

interface BacklinkGroup {
  sourcePath: string;
  snippet: string;
  count: number;
}

/** One row per LINKING NOTE, not per mention: five links from one note are one
 *  fact about that note, and five identical rows crowd out every other. */
export function groupBacklinks(
  backlinks: readonly { sourcePath: string; snippet: string }[],
): BacklinkGroup[] {
  const groups = new Map<string, BacklinkGroup>();
  for (const backlink of backlinks) {
    const existing = groups.get(backlink.sourcePath);
    if (existing === undefined) {
      groups.set(backlink.sourcePath, {
        sourcePath: backlink.sourcePath,
        snippet: backlink.snippet,
        count: 1,
      });
      continue;
    }
    existing.count += 1;
  }
  return [...groups.values()];
}

/** "3 linked mentions (2 shown)" keeps the old summary's truncation honesty;
 *  suggestions carry no count clause — a ranked top-N has no honest count of
 *  the rest. */
export function linkedMentionsSummary(shown: number, total: number): string {
  const counted = `${total} linked mention${total === 1 ? "" : "s"}`;
  return shown < total ? `${counted} (${shown} shown)` : counted;
}

/**
 * Both halves ride the knowledge query family, so the existing
 * files-changed/content-changed sweep of `orpc.knowledge` refreshes them — the
 * queries moved surfaces, the invalidation story did not. Backlinks fetch
 * regardless of the fold (a graph lookup, and the count is part of the
 * section's claim); suggestions only while OPEN, because that read settles the
 * index and runs a lexical probe per title token — too expensive to re-run on
 * every save for a list nobody is looking at.
 */
function useRelatedRows(docPath: string, open: boolean) {
  const backlinksQuery = useQuery(
    orpc.knowledge.backlinks.queryOptions({ input: { path: docPath } }),
  );
  const relatedQuery = useQuery({
    ...orpc.knowledge.related.queryOptions({ input: { path: docPath } }),
    enabled: open,
  });
  return { backlinksQuery, relatedQuery };
}

export function RelatedInline({
  docPath,
  onOpenDoc,
}: {
  docPath: string;
  onOpenDoc: (path: string) => void;
}) {
  // Default OPEN: linked mentions lead the list and are counted facts — the
  // old backlinks section's own default; only the suggestions half is
  // inferred, and its rows say so.
  const [open, setOpen] = useState(readRelatedOpen);
  const { backlinksQuery, relatedQuery } = useRelatedRows(docPath, open);

  const backlinks = backlinksQuery.data?.backlinks ?? [];
  const backlinkTotal = backlinksQuery.data?.total ?? 0;
  const related = relatedQuery.data?.related ?? [];

  const rows: RelatedRow[] = [
    ...groupBacklinks(backlinks).map((group) => ({
      path: group.sourcePath,
      label: docStem(group.sourcePath),
      detail:
        group.count === 1
          ? `Links here · ${plainSnippet(group.snippet)}`
          : `Links here ${String(group.count)}× · ${plainSnippet(group.snippet)}`,
    })),
    ...related.map((entry) => ({
      path: entry.path,
      label: entry.title,
      detail: entry.reasons.join(" · "),
    })),
  ];

  const settledEmpty =
    backlinksQuery.data !== undefined &&
    backlinkTotal === 0 &&
    (relatedQuery.isSuccess || relatedQuery.isError) &&
    related.length === 0;

  return (
    <div className="shrink-0 border-b border-line">
      <button
        type="button"
        aria-expanded={open}
        className="flex w-full items-center gap-1 px-3 py-1.5 text-[11px] font-medium text-muted-foreground uppercase hover:text-foreground"
        onClick={() => {
          const next = !open;
          writeRelatedOpen(next);
          setOpen(next);
        }}
      >
        <ChevronRightIcon className={cn("size-3 transition-transform", open && "rotate-90")} />
        Related
        {backlinkTotal > 0 ? (
          <span className="font-normal tabular-nums normal-case">
            {linkedMentionsSummary(backlinks.length, backlinkTotal)}
          </span>
        ) : null}
      </button>
      {open ? (
        <RelatedRows
          rows={rows}
          settledEmpty={settledEmpty}
          suggestionsFailed={relatedQuery.isError}
          onOpenDoc={onOpenDoc}
        />
      ) : null}
    </div>
  );
}

/** The unfolded list — pure, so the surface is testable without a query
 *  client (the old foot sections' own split). */
export function RelatedRows({
  rows,
  settledEmpty,
  suggestionsFailed,
  onOpenDoc,
}: {
  rows: readonly RelatedRow[];
  /** Every read settled and answered zero — distinct from still loading. */
  settledEmpty: boolean;
  /** The scorer read refused; the linked mentions above it still stand. */
  suggestionsFailed: boolean;
  onOpenDoc: (path: string) => void;
}) {
  return (
    <div className="max-h-64 overflow-y-auto px-1.5 pb-2">
      {rows.length === 0 ? (
        <p className="px-1.5 pb-1 text-xs text-muted-foreground">
          {settledEmpty ? "Nothing links here or shares this note's links, tags or words." : "…"}
        </p>
      ) : (
        <ul className="space-y-0.5">
          {rows.map((row) => (
            <li key={row.path + row.detail}>
              <button
                type="button"
                className="w-full rounded-md px-1.5 py-1 text-left hover:bg-surface-raised"
                onClick={() => {
                  onOpenDoc(row.path);
                }}
              >
                <span className="block truncate text-sm" title={row.path}>
                  {row.label}
                </span>
                <span className="block truncate text-xs text-muted-foreground">{row.detail}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {suggestionsFailed ? (
        <p className="px-1.5 pt-1 text-xs text-muted-foreground">
          Could not read suggestions just now.
        </p>
      ) : null}
    </div>
  );
}
