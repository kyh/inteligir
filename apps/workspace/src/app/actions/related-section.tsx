// no dedup between backlinks and suggestions: the scorer excludes direct neighbours by construction.

import { docStem } from "@repo/notes/knowledge/doc-file";
import { ANNOTATION_MARKER_STRIP_RE } from "@repo/notes/markdown/remark-inline-constructs";
import { wikiLinkLabel } from "@repo/notes/markdown/remark-wiki-link";
import { useQuery } from "@tanstack/react-query";
import { plural } from "@repo/ui/lib/plural";

import { orpc } from "../api";
import { PREFS, usePref } from "../prefs";
import { FoldSection } from "../fold-section";

export interface RelatedRow {
  path: string;
  label: string;
  detail: string;
}

export const plainSnippet = (snippet: string): string =>
  snippet
    .replaceAll(/!?\[\[(?<body>[^\]]+)\]\]/gu, (_match, body: string) => wikiLinkLabel(body))
    .replaceAll(/\{\{(?<body>[^{}]*)\}\}/gu, (_match, body: string) => body.split("|")[1] ?? "")
    .replaceAll(ANNOTATION_MARKER_STRIP_RE, "")
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

// suggestions fetch only while open: that read settles the index and runs a lexical probe per title token.
const useRelatedRows = (docPath: string, open: boolean) => {
  const backlinksQuery = useQuery(
    orpc.knowledge.backlinks.queryOptions({ input: { path: docPath } }),
  );
  const relatedQuery = useQuery({
    ...orpc.knowledge.related.queryOptions({ input: { path: docPath } }),
    enabled: open,
  });
  return { backlinksQuery, relatedQuery };
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
        {rows.map((row) => (
          <li key={row.path + row.detail}>
            <button
              type="button"
              className="w-full min-w-0 rounded-md px-1.5 py-1 text-left hover:bg-surface-raised"
              onClick={() => {
                onOpenDoc(row.path);
              }}
            >
              <span className="block truncate text-subtitle" title={row.path}>
                {row.label}
              </span>
              <span className="block truncate text-body text-muted-foreground">{row.detail}</span>
            </button>
          </li>
        ))}
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
  const [open, setOpen] = usePref(PREFS.relatedOpen);
  const { backlinksQuery, relatedQuery } = useRelatedRows(docPath, open);

  const backlinks = backlinksQuery.data?.backlinks ?? [];
  const backlinkTotal = backlinksQuery.data?.total ?? 0;
  const related = relatedQuery.data?.related ?? [];

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
  ];

  const settledEmpty =
    backlinksQuery.data !== undefined &&
    backlinkTotal === 0 &&
    (relatedQuery.isSuccess || relatedQuery.isError) &&
    related.length === 0;

  return (
    <FoldSection
      label="Related"
      {...(backlinkTotal > 0
        ? { summary: linkedMentionsSummary(backlinks.length, backlinkTotal) }
        : {})}
      open={open}
      onOpenChange={setOpen}
    >
      <RelatedRows
        rows={rows}
        settledEmpty={settledEmpty}
        suggestionsFailed={relatedQuery.isError}
        onOpenDoc={onOpenDoc}
      />
    </FoldSection>
  );
};
