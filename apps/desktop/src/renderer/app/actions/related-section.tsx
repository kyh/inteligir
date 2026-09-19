// no dedup between backlinks and suggestions: the scorer excludes direct neighbours by construction.

import type { UnlinkedMentionWire } from "@repo/api/local/knowledge/knowledge-schema";
import { docStem } from "@repo/notes/knowledge/doc-file";
import { isUuidWikiAlias } from "@repo/notes/markdown/remark-wiki-link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@repo/ui/components/button";
import { toast } from "@repo/ui/components/sonner";
import { plural } from "@repo/ui/lib/plural";
import { useState } from "react";

import { orpc } from "../api";
import { readRelatedOpen, writeRelatedOpen } from "../prefs";
import { FoldSection } from "../fold-section";
import { useWorkspace } from "../workspace-context";
import { linkMentionInNote, linkMentionMessage } from "./link-mention";

export interface RelatedRow {
  path: string;
  label: string;
  detail: string;
  // a second verb beside opening the note, drawn as its own button
  action?: { label: string; run: () => void };
}

export const plainSnippet = (snippet: string): string =>
  snippet
    .replaceAll(/!?\[\[(?<body>[^\]]+)\]\]/gu, (_match, body: string) => {
      const parts = body.split("|");
      const target = parts[0] ?? body;
      const alias = parts.length > 1 ? parts.at(-1) : undefined;
      const label = alias !== undefined && !isUuidWikiAlias(alias) ? alias : target;
      return label.split("#")[0] ?? label;
    })
    .replaceAll(/\{\{(?<body>[^{}]*)\}\}/gu, (_match, body: string) => body.split("|")[1] ?? "")
    .replaceAll(/%%i:[^%]*%%/gu, "")
    .replace(/^[\s>#*-]+/u, "")
    .replaceAll(/\s+/gu, " ")
    .trim();

interface BacklinkGroup {
  sourcePath: string;
  snippet: string;
  count: number;
}

// one row per linking note, not per mention.
export const groupBacklinks = (
  backlinks: readonly { sourcePath: string; snippet: string }[],
): BacklinkGroup[] => {
  const groups = new Map<string, BacklinkGroup>();
  for (const backlink of backlinks) {
    const existing = groups.get(backlink.sourcePath);
    if (existing === undefined) {
      groups.set(backlink.sourcePath, {
        count: 1,
        snippet: backlink.snippet,
        sourcePath: backlink.sourcePath,
      });
      continue;
    }
    existing.count += 1;
  }
  return [...groups.values()];
};

export const linkedMentionsSummary = (shown: number, total: number): string => {
  const counted = plural(total, "linked mention");
  return shown < total ? `${counted} (${shown} shown)` : counted;
};

export const unlinkedMentionDetail = (mention: UnlinkedMentionWire): string => {
  const sentence = plainSnippet(`${mention.before}${mention.text}${mention.after}`);
  return mention.count > 1
    ? `Mentions ${String(mention.count)}× · ${sentence}`
    : `Mentions · ${sentence}`;
};

// suggestions fetch only while open: that read settles the index and runs a lexical probe per title token.
const useRelatedRows = (docPath: string, open: boolean) => {
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
};

export const RelatedRows = ({
  rows,
  settledEmpty,
  suggestionsFailed,
  onOpenDoc,
}: {
  rows: readonly RelatedRow[];
  settledEmpty: boolean;
  suggestionsFailed: boolean;
  onOpenDoc: (path: string) => void;
}) => (
  <div className="max-h-64 overflow-y-auto px-1.5 pb-2">
    {rows.length === 0 ? (
      <p className="px-1.5 pb-1 text-body text-muted-foreground">
        {settledEmpty ? "Nothing links here or shares this note's links, tags or words." : "…"}
      </p>
    ) : (
      <ul className="space-y-0.5">
        {rows.map((row) => {
          const { action } = row;
          return (
            <li key={row.path + row.detail} className="flex items-center gap-1">
              <button
                type="button"
                className="min-w-0 flex-1 rounded-md px-1.5 py-1 text-left hover:bg-surface-raised"
                onClick={() => {
                  onOpenDoc(row.path);
                }}
              >
                <span className="block truncate text-subtitle" title={row.path}>
                  {row.label}
                </span>
                <span className="block truncate text-body text-muted-foreground">{row.detail}</span>
              </button>
              {action === undefined ? null : (
                <Button
                  variant="tertiary"
                  size="compact"
                  onClick={() => {
                    action.run();
                  }}
                >
                  {action.label}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    )}
    {suggestionsFailed ? (
      <p className="px-1.5 pt-1 text-body text-muted-foreground">
        Could not read suggestions just now.
      </p>
    ) : null}
  </div>
);

export const RelatedInline = ({
  docPath,
  onOpenDoc,
}: {
  docPath: string;
  onOpenDoc: (path: string) => void;
}) => {
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
      toast[outcome.kind === "written" ? "success" : "error"](
        linkMentionMessage(outcome, mention.path),
      );
      void queryClient.invalidateQueries({ queryKey: orpc.knowledge.key() });
    })();
  };

  const rows: RelatedRow[] = [
    ...groupBacklinks(backlinks).map((group) => ({
      detail:
        group.count === 1
          ? `Links here · ${plainSnippet(group.snippet)}`
          : `Links here ${String(group.count)}× · ${plainSnippet(group.snippet)}`,
      label: docStem(group.sourcePath),
      path: group.sourcePath,
    })),
    ...related.map((entry) => ({
      detail: entry.reasons.join(" · "),
      label: entry.title,
      path: entry.path,
    })),
    ...unlinked.map((mention) => ({
      action: {
        label: "Link",
        run: () => {
          link(mention);
        },
      },
      detail: unlinkedMentionDetail(mention),
      label: docStem(mention.path),
      path: mention.path,
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
    <FoldSection
      label="Related"
      {...(backlinkTotal > 0
        ? { summary: linkedMentionsSummary(backlinks.length, backlinkTotal) }
        : {})}
      open={open}
      onOpenChange={(next) => {
        writeRelatedOpen(next);
        setOpen(next);
      }}
    >
      <RelatedRows
        rows={rows}
        settledEmpty={settledEmpty}
        suggestionsFailed={relatedQuery.isError || unlinkedQuery.isError}
        onOpenDoc={onOpenDoc}
      />
    </FoldSection>
  );
};
