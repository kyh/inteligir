// The panel's History tab: every revision of the open note, what restoring one
// would change, and the restore itself. A READ over the vault's own git repo,
// so it works offline and with no remote — the posture the vault already takes.
//
// The current side of the diff is the OPEN BUFFER, not a cached read: the
// note's bytes are not query state (the buffer is the file), and the user must
// be shown a diff against what is on their screen. The CAS base is that exact
// snapshot, so a note that moved underneath refuses the restore instead of
// blessing bytes the diff never showed.

import {
  contentHashHex,
  VAULT_HISTORY_DEFAULT_LIMIT,
  VAULT_HISTORY_MAX_LIMIT,
  type VaultRevision,
} from "@repo/api/local/vault/vault-schema";
import { useOpenNote } from "@repo/editor/note/open-note-context";
import { flushOpenNote } from "@repo/editor/note/open-note-flush";
import { Button } from "@repo/ui/components/button";
import { toast } from "@repo/ui/components/sonner";
import { cn } from "@repo/ui/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeftIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { isDefinedError, orpc, refusalMessage, safe } from "../api";
import { relativeTimeLabel } from "../relative-time";
import { useWorkspace } from "../workspace-context";
import { diffRows, type DiffRow } from "./history-diff";

type RestoreOutcome = { kind: "restored" } | { kind: "refused"; message: string };

const RESTORE_REFUSED = "The restore was refused.";

/** The abbreviation git itself shows, and what `inteligir vault revision`
 *  accepts back. */
function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

function RevisionRow({
  revision,
  asOfMs,
  onSelect,
}: {
  revision: VaultRevision;
  asOfMs: number;
  onSelect: (revision: VaultRevision) => void;
}) {
  return (
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
}

const DIFF_LINE = {
  context: { mark: " ", className: "text-muted-foreground" },
  removed: { mark: "-", className: "bg-red-500/10 text-red-700 dark:text-red-300" },
  added: { mark: "+", className: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" },
} satisfies Record<"context" | "removed" | "added", { mark: string; className: string }>;

function DiffRowView({ row }: { row: DiffRow }) {
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
}

function RevisionDetail({
  docPath,
  current,
  revision,
  onBack,
}: {
  docPath: string;
  /** The open buffer's bytes — the diff's base and the restore's CAS base. */
  current: string;
  revision: VaultRevision;
  onBack: () => void;
}) {
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
      // The buffer's own bytes have to be on disk before the CAS base below
      // means anything, and a flush that failed leaves them where this write
      // would silently discard them.
      if (!(await flushOpenNote())) {
        return {
          kind: "refused",
          message: "The note could not be saved, so nothing was restored.",
        };
      }
      // Checkpoint what is about to be replaced: the auto-commit is
      // session-shaped, so bytes saved seconds ago are in no revision yet and
      // overwriting them would leave them in none at all.
      await api.vault.commitNow();
      const { error } = await safe(
        api.vault.write({
          path: docPath,
          content: bytes,
          expectedHash: await contentHashHex(current),
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
    onSuccess: (outcome) => {
      if (outcome.kind === "refused") {
        toast.error(outcome.message);
        return;
      }
      toast.success(`Restored ${docPath} to ${shortSha(revision.sha)}.`);
      void queryClient.invalidateQueries({ queryKey: orpc.vault.history.key() });
      onBack();
    },
    onError: (cause: unknown) => {
      toast.error(refusalMessage(cause, RESTORE_REFUSED));
    },
  });

  const identical = rows !== null && rows.length === 0;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1 border-b border-line px-2 py-1.5 text-sm">
        <Button size="icon-xs" variant="ghost" aria-label="Back to history" onClick={onBack}>
          <ArrowLeftIcon />
        </Button>
        <span className="min-w-0 flex-1 truncate font-medium">{revision.subject}</span>
        <Button
          size="xs"
          variant="outline"
          disabled={restore.isPending || content === null || identical}
          onClick={() => {
            if (content !== null) restore.mutate(content);
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
        {rows === null ? (
          <p className="p-3 text-sm text-muted-foreground">
            {revisionQuery.isError ? "This revision could not be read." : "Reading…"}
          </p>
        ) : identical ? (
          <p className="p-3 text-sm text-muted-foreground">
            This revision is what the note holds right now.
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
}

export function HistoryTab({ docPath }: { docPath: string | null }) {
  const [selected, setSelected] = useState<VaultRevision | null>(null);
  const [limit, setLimit] = useState(VAULT_HISTORY_DEFAULT_LIMIT);
  // The buffer only answers for the note it has LOADED: a switch publishes the
  // new path before its bytes arrive, and diffing the outgoing note's text
  // against this note's revision would be a diff of two different files.
  const current = useOpenNote((state) =>
    state.editor.path === docPath ? state.editor.content : null,
  );
  // `staleTime` is Infinity app-wide, and a commit announces nothing — so this
  // is the one query that has to re-ask whenever the tab is opened.
  const historyQuery = useQuery({
    ...orpc.vault.history.queryOptions({ input: { path: docPath ?? "", limit } }),
    staleTime: 0,
    enabled: docPath !== null,
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
      {revisions.length < limit ? null : limit < VAULT_HISTORY_MAX_LIMIT ? (
        <Button
          size="xs"
          variant="ghost"
          className="mt-1 w-full"
          onClick={() => {
            setLimit(Math.min(limit * 2, VAULT_HISTORY_MAX_LIMIT));
          }}
        >
          Show older revisions
        </Button>
      ) : (
        <p className="p-2 text-[11px] text-muted-foreground">
          Older revisions are in the vault's git log.
        </p>
      )}
      {revisions.length === 0 && !historyQuery.isPending ? (
        <p className="p-3 text-sm text-muted-foreground">
          No revisions yet. Edits are committed once you pause.
        </p>
      ) : null}
    </div>
  );
}
