import {
  VAULT_HISTORY_MAX_LIMIT,
  type VaultHistoryRequest,
  type VaultHistoryResponse,
} from "@repo/api/local/vault/vault-schema";
import { readingMinutes, useNoteStats } from "@repo/editor/note-stats";
import { useQuery } from "@tanstack/react-query";

import { useState } from "react";

import { orpc } from "../api";
import { FoldSection } from "../fold-section";
import { relativeTimeLabel, useNow } from "../relative-time";
import { useVaultTree } from "../vault-hooks";
import { useWorkspace } from "../workspace-context";

interface HistoryReader {
  vault: {
    history(input: VaultHistoryRequest): Promise<VaultHistoryResponse>;
  };
}

// the log answers newest first, so the first revision is the last row of the last page
export async function firstRevisionAuthoredAt(
  api: HistoryReader,
  path: string,
): Promise<string | null> {
  let skip = 0;
  let oldest: string | null = null;
  for (;;) {
    const page = await api.vault.history({ path, skip, limit: VAULT_HISTORY_MAX_LIMIT });
    const tail = page.revisions.at(-1);
    if (tail !== undefined) oldest = tail.authoredAt;
    if (page.revisions.length < VAULT_HISTORY_MAX_LIMIT) return oldest;
    skip += VAULT_HISTORY_MAX_LIMIT;
  }
}

export function readingTimeLabel(words: number): string {
  const minutes = readingMinutes(words);
  return minutes === 0 ? "—" : `${String(minutes)} min`;
}

function Fact({
  label,
  title,
  children,
}: {
  label: string;
  // `| undefined` spelled out so a caller may pass an absent time under exactOptionalPropertyTypes
  title?: string | undefined;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[6rem_1fr] items-baseline gap-x-3 text-xs">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate tabular-nums" title={title}>
        {children}
      </dd>
    </div>
  );
}

function useNoteCreatedAt(docPath: string) {
  const { api } = useWorkspace();
  return useQuery({
    queryKey: ["note-created", docPath],
    queryFn: () => firstRevisionAuthoredAt(api, docPath),
    // a note with no revision yet gets one at the next auto-commit; a dated one never changes
    staleTime: (query) => (query.state.data === null ? 0 : Infinity),
  });
}

function absoluteTime(ms: number | null): string | undefined {
  return ms === null ? undefined : new Date(ms).toLocaleString();
}

function NoteFactRows({ docPath }: { docPath: string }) {
  const now = useNow();
  const treeQuery = useVaultTree();
  const entry = treeQuery.data?.entries.find(
    (candidate) => candidate.kind === "file" && candidate.path === docPath,
  );
  const modifiedMs = entry?.kind === "file" ? (entry.modifiedMs ?? null) : null;
  const createdQuery = useNoteCreatedAt(docPath);
  const stats = useNoteStats(docPath);
  const backlinksQuery = useQuery(
    orpc.knowledge.backlinks.queryOptions({ input: { path: docPath } }),
  );
  const createdMs =
    createdQuery.data === undefined || createdQuery.data === null
      ? null
      : new Date(createdQuery.data).getTime();

  return (
    <dl className="space-y-1 px-3 pb-2">
      <Fact label="Path" title={docPath}>
        <span className="font-mono">{docPath}</span>
      </Fact>
      <Fact label="Modified" title={absoluteTime(modifiedMs)}>
        {modifiedMs === null ? "—" : relativeTimeLabel(modifiedMs, now)}
      </Fact>
      <Fact label="Created" title={absoluteTime(createdMs)}>
        {createdQuery.data === undefined
          ? "…"
          : createdMs === null
            ? "Not committed yet"
            : relativeTimeLabel(createdMs, now)}
      </Fact>
      <Fact label="Words">{stats === null ? "—" : stats.words.toLocaleString()}</Fact>
      <Fact label="Characters">{stats === null ? "—" : stats.characters.toLocaleString()}</Fact>
      <Fact label="Reading time">{stats === null ? "—" : readingTimeLabel(stats.words)}</Fact>
      <Fact label="Backlinks">
        {backlinksQuery.data === undefined ? "…" : backlinksQuery.data.total.toLocaleString()}
      </Fact>
    </dl>
  );
}

// folded by default: unfolding is what reads the git log for the created date
export function NoteFacts({ docPath }: { docPath: string }) {
  const [open, setOpen] = useState(false);
  return (
    <FoldSection label="About" open={open} onOpenChange={setOpen}>
      <NoteFactRows docPath={docPath} />
    </FoldSection>
  );
}
