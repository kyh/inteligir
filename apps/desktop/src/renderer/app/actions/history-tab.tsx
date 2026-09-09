// the diff's current side is the open buffer, and the CAS base is that same snapshot: a
// note that moved underneath refuses the restore rather than blessing bytes the diff never showed.

import {
  contentHashHex,
  VAULT_HISTORY_DEFAULT_LIMIT,
  VAULT_HISTORY_MAX_LIMIT,
} from "@repo/api/local/vault/vault-schema";
import type { VaultRevision } from "@repo/api/local/vault/vault-schema";
import { useOpenNote } from "@repo/editor/note/open-note-context";
import { flushOpenNote } from "@repo/editor/note/open-note-flush";
import { Button } from "@repo/ui/components/button";
import { toast } from "@repo/ui/components/sonner";
import { cn } from "cn";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeftIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { isDefinedError, orpc, refusalMessage, safe } from "../api";
import { relativeTimeLabel } from "../relative-time";
import { useWorkspace } from "../workspace-context";
import { diffRows } from "./history-diff";
import type { DiffRow } from "./history-diff";
import { ReadRefusal } from "./read-refusal";

type RestoreOutcome = { kind: "restored" } | { kind: "refused"; message: string };

const RESTORE_REFUSED = "The restore was refused.";

const shortSha = (sha: string): string => sha.slice(0, 7);

const RevisionRow = ({
  revision,
  asOfMs,
  onSelect,
}: {
  revision: VaultRevision;
  asOfMs: number;
  onSelect: (revision: VaultRevision) => void;
}) => (
  <button
    type="button"
    className="w-full rounded-md px-2 py-1.5 text-left hover:bg-surface-raised"
    onClick={() => {
      onSelect(revision);
    }}
  >
    <p className="truncate text-sm">{revision.subject}</p>
    <p className="flex items-baseline gap-2 text-[11px] text-muted-foreground">
      <span className="font-medium text-foreground/80">{revision.authorName}</span>
      <span>{relativeTimeLabel(Date.parse(revision.authoredAt), asOfMs)}</span>
      <span className="font-mono">{shortSha(revision.sha)}</span>
    </p>
    {revision.renamedFrom === undefined ? null : (
      <p className="truncate text-[11px] text-muted-foreground">
        Renamed from {revision.renamedFrom}
      </p>
    )}
  </button>
);

const DIFF_LINE = {
  added: { className: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300", mark: "+" },
  context: { className: "text-muted-foreground", mark: " " },
  removed: { className: "bg-red-500/10 text-red-700 dark:text-red-300", mark: "-" },
} satisfies Record<"context" | "removed" | "added", { mark: string; className: string }>;

const revisionBody = (unread: boolean, refused: boolean): string => {
  if (!unread) {
    return "This revision is what the note holds right now.";
  }
  return refused ? "This revision could not be read." : "Reading…";
};

const DiffRowView = ({ row }: { row: DiffRow }) => {
  if (row.kind === "gap") {
    return <div className="py-1 text-center text-muted-foreground">⋯ {row.lines} unchanged</div>;
  }
  if (row.kind === "truncated") {
    return (
      <div className="py-1 text-center text-muted-foreground">
        ⋯ {row.lines} more changed lines not shown
      </div>
    );
  }
  const line = DIFF_LINE[row.kind];
  return (
    <div className={cn("px-1 whitespace-pre-wrap", line.className)}>
      {line.mark}
      {row.text}
    </div>
  );
};

const RevisionDetail = ({
  docPath,
  current,
  revision,
  onBack,
}: {
  docPath: string;
  current: string;
  revision: VaultRevision;
  onBack: () => void;
}) => {
  const { api } = useWorkspace();
  const queryClient = useQueryClient();
  const revisionQuery = useQuery(
    orpc.vault.revision.queryOptions({ input: { path: revision.path, sha: revision.sha } }),
  );
  const content = revisionQuery.data?.content ?? null;
  const rows = useMemo(
    () => (content === null ? null : diffRows(current, content)),
    [current, content],
  );

  const restore = useMutation({
    mutationFn: async (bytes: string): Promise<RestoreOutcome> => {
      // the buffer must be on disk before the CAS base means anything.
      if (!(await flushOpenNote())) {
        return {
          kind: "refused",
          message: "The note could not be saved, so nothing was restored.",
        };
      }
      // the auto-commit is session-shaped, so bytes saved seconds ago are in no revision yet.
      await api.vault.commitNow();
      const { error } = await safe(
        api.vault.write({
          content: bytes,
          expectedHash: await contentHashHex(current),
          path: docPath,
        }),
      );
      if (error === null) {
        return { kind: "restored" };
      }
      if (isDefinedError(error) && error.code === "CAS_MISMATCH") {
        return {
          kind: "refused",
          message: "The note changed while this restore was in flight. Look again and retry.",
        };
      }
      return { kind: "refused", message: refusalMessage(error, RESTORE_REFUSED) };
    },
    onError: (cause: unknown) => {
      toast.error(refusalMessage(cause, RESTORE_REFUSED));
    },
    onSuccess: (outcome) => {
      if (outcome.kind === "refused") {
        toast.error(outcome.message);
        return;
      }
      toast.success(`Restored ${docPath} to ${shortSha(revision.sha)}.`);
      void queryClient.invalidateQueries({ queryKey: orpc.vault.history.key() });
      onBack();
    },
  });

  const identical = rows !== null && rows.length === 0;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1 border-b border-line px-2 py-1.5 text-sm">
        <Button size="icon-compact" variant="ghost" aria-label="Back to history" onClick={onBack}>
          <ArrowLeftIcon />
        </Button>
        <span className="min-w-0 flex-1 truncate font-medium">{revision.subject}</span>
        <Button
          size="compact"
          variant="tertiary"
          disabled={restore.isPending || content === null || identical}
          onClick={() => {
            if (content !== null) {
              restore.mutate(content);
            }
          }}
        >
          Restore
        </Button>
      </div>
      <div className="shrink-0 border-b border-line px-3 py-1.5 text-[11px] text-muted-foreground">
        {revision.authorName} · {new Date(revision.authoredAt).toLocaleString()} ·{" "}
        <span className="font-mono">{shortSha(revision.sha)}</span>
        {revision.path === docPath ? null : <> · was {revision.path}</>}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {rows === null || identical ? (
          <p className="p-3 text-sm text-muted-foreground">
            {revisionBody(rows === null, revisionQuery.isError)}
          </p>
        ) : (
          <div className="p-2 font-mono text-xs leading-5">
            {rows.map((row) => (
              <DiffRowView key={row.id} row={row} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

const OlderRevisions = ({ limit, onMore }: { limit: number; onMore: () => void }) =>
  limit < VAULT_HISTORY_MAX_LIMIT ? (
    <Button size="compact" variant="ghost" className="mt-1 w-full" onClick={onMore}>
      Show older revisions
    </Button>
  ) : (
    <p className="p-2 text-[11px] text-muted-foreground">
      Older revisions are in the vault&apos;s git log.
    </p>
  );

export const HistoryTab = ({ docPath }: { docPath: string | null }) => {
  const [selected, setSelected] = useState<VaultRevision | null>(null);
  const [limit, setLimit] = useState(VAULT_HISTORY_DEFAULT_LIMIT);
  // a switch publishes the new path before its bytes arrive; only the loaded note's text may diff.
  const current = useOpenNote((state) =>
    state.editor.path === docPath ? state.editor.content : null,
  );
  // `staleTime` is Infinity app-wide and a commit announces nothing, so this query re-asks per open.
  // no retries: an off-lock `git log` refusal is deterministic.
  const historyQuery = useQuery({
    ...orpc.vault.history.queryOptions({ input: { limit, path: docPath ?? "" } }),
    enabled: docPath !== null,
    retry: false,
    staleTime: 0,
  });

  if (docPath === null) {
    return <p className="p-3 text-sm text-muted-foreground">Open a note to see its history.</p>;
  }
  if (selected !== null && current !== null) {
    return (
      <RevisionDetail
        docPath={docPath}
        current={current}
        revision={selected}
        onBack={() => {
          setSelected(null);
        }}
      />
    );
  }

  if (historyQuery.isError) {
    return <ReadRefusal lead="The history could not be read." error={historyQuery.error} />;
  }

  const revisions = historyQuery.data?.revisions ?? [];
  const asOfMs = historyQuery.dataUpdatedAt;
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
      {revisions.map((revision) => (
        <RevisionRow
          key={revision.sha}
          revision={revision}
          asOfMs={asOfMs}
          onSelect={setSelected}
        />
      ))}
      {revisions.length < limit ? null : (
        <OlderRevisions
          limit={limit}
          onMore={() => {
            setLimit(Math.min(limit * 2, VAULT_HISTORY_MAX_LIMIT));
          }}
        />
      )}
      {revisions.length === 0 && !historyQuery.isPending ? (
        <p className="p-3 text-sm text-muted-foreground">
          No revisions yet. Edits are committed once you pause.
        </p>
      ) : null}
    </div>
  );
};
