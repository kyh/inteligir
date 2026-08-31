// The panel's History tab: every revision of the open note, what restoring
// one would change, and the restore itself.
//
// The whole surface is a READ over the vault's own git repo — no new storage,
// no sync dependency, no cloud call — so it works offline and with no remote
// configured, which is the posture the vault already takes.
//
// Author is the agent-vs-human distinction, and it is the commit's own author
// rather than a flag beside it: engine commits say "inteligir", an agent turn
// carries its own name. Nothing here can drift out of step with the log.

import type { VaultRevision } from "@repo/api/local/vault/vault-schema";
import { flushOpenNote } from "@repo/editor/note/open-note-flush";
import { Button } from "@repo/ui/components/button";
import { toast } from "@repo/ui/components/sonner";
import { cn } from "@repo/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeftIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { orpc } from "../api";
import { relativeTimeLabel } from "../relative-time";
import { useWorkspace } from "../workspace-context";
import { diffRows, type DiffRow } from "./history-diff";
import { restoreRevision } from "./restore-revision";

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

const DIFF_ROW_CLASS = {
  context: "text-muted-foreground",
  removed: "bg-red-500/10 text-red-700 dark:text-red-300",
  added: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
} satisfies Record<Exclude<DiffRow["kind"], "gap">, string>;

const DIFF_ROW_MARK = { context: " ", removed: "-", added: "+" } satisfies Record<
  Exclude<DiffRow["kind"], "gap">,
  string
>;

function DiffView({ rows }: { rows: readonly DiffRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="p-3 text-sm text-muted-foreground">
        This revision is what the note holds right now.
      </p>
    );
  }
  return (
    <div className="p-2 font-mono text-xs leading-5">
      {rows.map((row) =>
        row.kind === "gap" ? (
          <div key={row.id} className="py-1 text-center text-muted-foreground">
            ⋯ {row.lines} unchanged
          </div>
        ) : (
          <div key={row.id} className={cn("px-1 whitespace-pre-wrap", DIFF_ROW_CLASS[row.kind])}>
            {DIFF_ROW_MARK[row.kind]}
            {row.text}
          </div>
        ),
      )}
    </div>
  );
}

function RevisionDetail({
  docPath,
  revision,
  onBack,
}: {
  docPath: string;
  revision: VaultRevision;
  onBack: () => void;
}) {
  const { api } = useWorkspace();
  const [restoring, setRestoring] = useState(false);
  const revisionQuery = useQuery(
    orpc.vault.revision.queryOptions({ input: { path: revision.path, sha: revision.sha } }),
  );
  const currentQuery = useQuery(orpc.vault.read.queryOptions({ input: { path: docPath } }));

  const rows = useMemo(
    () =>
      revisionQuery.data === undefined || currentQuery.data === undefined
        ? null
        : diffRows(currentQuery.data.content, revisionQuery.data.content),
    [revisionQuery.data, currentQuery.data],
  );

  const restore = (): void => {
    if (restoring) {
      return;
    }
    setRestoring(true);
    void (async () => {
      try {
        // The buffer's own bytes land FIRST: the restore's CAS base is read
        // from disk, so an unsaved edit would make this write claim a base
        // that was never on it.
        await flushOpenNote();
        const outcome = await restoreRevision(api, {
          docPath,
          revisionPath: revision.path,
          sha: revision.sha,
        });
        if (outcome.kind === "refused") {
          toast.error(outcome.message);
          return;
        }
        if (outcome.kind === "unchanged") {
          toast.info("This revision is already what the note holds.");
          return;
        }
        toast.success(`Restored ${docPath} to ${shortSha(revision.sha)}.`);
        onBack();
      } finally {
        setRestoring(false);
      }
    })();
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1 border-b border-line px-2 py-1.5 text-sm">
        <Button size="icon-xs" variant="ghost" aria-label="Back to history" onClick={onBack}>
          <ArrowLeftIcon />
        </Button>
        <span className="min-w-0 flex-1 truncate font-medium">{revision.subject}</span>
        <Button size="xs" variant="outline" disabled={restoring || rows === null} onClick={restore}>
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
            {revisionQuery.isError || currentQuery.isError
              ? "This revision could not be read."
              : "Reading…"}
          </p>
        ) : (
          <DiffView rows={rows} />
        )}
      </div>
    </div>
  );
}

export function HistoryTab({ docPath }: { docPath: string | null }) {
  const [selected, setSelected] = useState<VaultRevision | null>(null);
  const historyQuery = useQuery({
    ...orpc.vault.history.queryOptions({ input: { path: docPath ?? "" } }),
    enabled: docPath !== null,
  });

  if (docPath === null) {
    return <p className="p-3 text-sm text-muted-foreground">Open a note to see its history.</p>;
  }
  if (selected !== null) {
    return (
      <RevisionDetail
        docPath={docPath}
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
      {revisions.length === 0 && !historyQuery.isPending ? (
        <p className="p-3 text-sm text-muted-foreground">
          No revisions yet. Edits are committed once you pause.
        </p>
      ) : null}
    </div>
  );
}
