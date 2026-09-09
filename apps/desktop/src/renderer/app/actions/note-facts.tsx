import { VAULT_HISTORY_MAX_LIMIT } from "@repo/api/local/vault/vault-schema";
import type { VaultHistoryRequest, VaultHistoryResponse } from "@repo/api/local/vault/vault-schema";
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
    history: (input: VaultHistoryRequest) => Promise<VaultHistoryResponse>;
  };
}

// the log answers newest first, so the first revision is the last row of the last page
export const firstRevisionAuthoredAt = async (
  api: HistoryReader,
  path: string,
): Promise<string | null> => {
  let skip = 0;
  let oldest: string | null = null;
  for (;;) {
    const page = await api.vault.history({ limit: VAULT_HISTORY_MAX_LIMIT, path, skip });
    const tail = page.revisions.at(-1);
    if (tail !== undefined) {
      oldest = tail.authoredAt;
    }
    if (page.revisions.length < VAULT_HISTORY_MAX_LIMIT) {
      return oldest;
    }
    skip += VAULT_HISTORY_MAX_LIMIT;
  }
};

export const readingTimeLabel = (words: number): string => {
  const minutes = readingMinutes(words);
  return minutes === 0 ? "—" : `${String(minutes)} min`;
};

const Fact = ({
  label,
  title,
  children,
}: {
  label: string;
  // `| undefined` spelled out so a caller may pass an absent time under exactOptionalPropertyTypes
  title?: string | undefined;
  children: React.ReactNode;
}) => (
  <div className="grid grid-cols-[6rem_1fr] items-baseline gap-x-3 text-xs">
    <dt className="text-muted-foreground">{label}</dt>
    <dd className="min-w-0 truncate tabular-nums" title={title}>
      {children}
    </dd>
  </div>
);

const useNoteCreatedAt = (docPath: string) => {
  const { api } = useWorkspace();
  return useQuery({
    queryFn: async () => await firstRevisionAuthoredAt(api, docPath),
    queryKey: ["note-created", docPath],
    // a note with no revision yet gets one at the next auto-commit; a dated one never changes
    staleTime: (query) => (query.state.data === null ? 0 : Infinity),
  });
};

const createdLabel = (
  authoredAt: string | null | undefined,
  createdMs: number | null,
  now: number,
): string => {
  if (authoredAt === undefined) {
    return "…";
  }
  return createdMs === null ? "Not committed yet" : relativeTimeLabel(createdMs, now);
};

const absoluteTime = (ms: number | null): string | undefined =>
  ms === null ? undefined : new Date(ms).toLocaleString();

const NoteFactRows = ({ docPath }: { docPath: string }) => {
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
        {createdLabel(createdQuery.data, createdMs, now)}
      </Fact>
      <Fact label="Words">{stats === null ? "—" : stats.words.toLocaleString()}</Fact>
      <Fact label="Characters">{stats === null ? "—" : stats.characters.toLocaleString()}</Fact>
      <Fact label="Reading time">{stats === null ? "—" : readingTimeLabel(stats.words)}</Fact>
      <Fact label="Backlinks">
        {backlinksQuery.data === undefined ? "…" : backlinksQuery.data.total.toLocaleString()}
      </Fact>
    </dl>
  );
};

// folded by default: unfolding is what reads the git log for the created date
export const NoteFacts = ({ docPath }: { docPath: string }) => {
  const [open, setOpen] = useState(false);
  return (
    <FoldSection label="About" open={open} onOpenChange={setOpen}>
      <NoteFactRows docPath={docPath} />
    </FoldSection>
  );
};
