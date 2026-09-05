// no dedup between backlinks and suggestions: the scorer excludes direct neighbours by construction.

import type { UnlinkedMentionWire } from "@repo/api/local/knowledge/knowledge-schema";
import { docStem } from "@repo/notes/knowledge/doc-file";
import { isUuidWikiAlias } from "@repo/notes/markdown/remark-wiki-link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@repo/ui/components/button";
import { toast } from "@repo/ui/components/sonner";
import { cn } from "@repo/ui/lib/utils";
import { ChevronRightIcon } from "lucide-react";
import { useState } from "react";

import { orpc } from "../api";
import { readRelatedOpen, writeRelatedOpen } from "../prefs";
import { useWorkspace } from "../workspace-context";
import { linkMentionInNote, linkMentionMessage } from "./link-mention";

export interface RelatedRow {
  path: string;
  label: string;
  detail: string;
  // a second verb beside opening the note, drawn as its own button
  action?: { label: string; run: () => void };
}

export function plainSnippet(snippet: string): string {
  return snippet
    .replace(/!?\[\[([^\]]+)\]\]/gu, (_match, body: string) => {
      const parts = body.split("|");
      const target = parts[0] ?? body;
      const alias = parts.length > 1 ? parts.at(-1) : undefined;
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

// one row per linking note, not per mention.
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

export function linkedMentionsSummary(shown: number, total: number): string {
  const counted = `${total} linked mention${total === 1 ? "" : "s"}`;
  return shown < total ? `${counted} (${shown} shown)` : counted;
}

export function unlinkedMentionDetail(mention: UnlinkedMentionWire): string {
  const sentence = plainSnippet(`${mention.before}${mention.text}${mention.after}`);
  return mention.count > 1
    ? `Mentions ${String(mention.count)}× · ${sentence}`
    : `Mentions · ${sentence}`;
}

// suggestions fetch only while open: that read settles the index and runs a lexical probe per title token.
function useRelatedRows(docPath: string, open: boolean) {
  const backlinksQuery = useQuery(
    orpc.knowledge.backlinks.queryOptions({ input: { path: docPath } }),
  );
  const relatedQuery = useQuery({
    ...orpc.knowledge.related.queryOptions({ input: { path: docPath } }),
    enabled: open,
  });
  const unlinkedQuery = useQuery({
    ...orpc.knowledge.unlinkedMentions.queryOptions({ input: { path: docPath } }),
    enabled: open,
  });
  return { backlinksQuery, relatedQuery, unlinkedQuery };
}

export function RelatedInline({
  docPath,
  onOpenDoc,
}: {
  docPath: string;
  onOpenDoc: (path: string) => void;
}) {
  const [open, setOpen] = useState(readRelatedOpen);
  const { api } = useWorkspace();
  const queryClient = useQueryClient();
  const { backlinksQuery, relatedQuery, unlinkedQuery } = useRelatedRows(docPath, open);

  const backlinks = backlinksQuery.data?.backlinks ?? [];
  const backlinkTotal = backlinksQuery.data?.total ?? 0;
  const related = relatedQuery.data?.related ?? [];
  const unlinked = unlinkedQuery.data?.mentions ?? [];

  // the sweep on files-changed moves the row to backlinks; the refetch here only shortens the wait
  const link = (mention: UnlinkedMentionWire): void => {
    void (async () => {
      const outcome = await linkMentionInNote(api, mention, docStem(docPath));
      toast[outcome.kind === "linked" ? "success" : "error"](
        linkMentionMessage(outcome, mention.path),
      );
      void queryClient.invalidateQueries({ queryKey: orpc.knowledge.key() });
    })();
  };

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
    ...unlinked.map((mention) => ({
      path: mention.path,
      label: docStem(mention.path),
      detail: unlinkedMentionDetail(mention),
      action: {
        label: "Link",
        run: () => {
          link(mention);
        },
      },
    })),
  ];

  const settledEmpty =
    backlinksQuery.data !== undefined &&
    backlinkTotal === 0 &&
    (relatedQuery.isSuccess || relatedQuery.isError) &&
    related.length === 0 &&
    (unlinkedQuery.isSuccess || unlinkedQuery.isError) &&
    unlinked.length === 0;

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
          suggestionsFailed={relatedQuery.isError || unlinkedQuery.isError}
          onOpenDoc={onOpenDoc}
        />
      ) : null}
    </div>
  );
}

export function RelatedRows({
  rows,
  settledEmpty,
  suggestionsFailed,
  onOpenDoc,
}: {
  rows: readonly RelatedRow[];
  settledEmpty: boolean;
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
            <li key={row.path + row.detail} className="flex items-center gap-1">
              <button
                type="button"
                className="min-w-0 flex-1 rounded-md px-1.5 py-1 text-left hover:bg-surface-raised"
                onClick={() => {
                  onOpenDoc(row.path);
                }}
              >
                <span className="block truncate text-sm" title={row.path}>
                  {row.label}
                </span>
                <span className="block truncate text-xs text-muted-foreground">{row.detail}</span>
              </button>
              {row.action === undefined ? null : (
                <Button variant="tertiary" size="compact" onClick={row.action.run}>
                  {row.action.label}
                </Button>
              )}
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
