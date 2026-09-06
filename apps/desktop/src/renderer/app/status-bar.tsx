import { useNoteStats } from "@repo/editor/note-stats";
import { Button } from "@repo/ui/components/button";
import { Spinner } from "@repo/ui/components/spinner";
import { plural } from "@repo/ui/lib/plural";
import { cn } from "cn";
import { ArchiveRestoreIcon, SettingsIcon } from "lucide-react";
import { readingTimeLabel } from "./actions/note-facts";
import { useThreads } from "./actions/thread-hooks";
import {
  canSyncNow,
  syncBlockedReason,
  syncStateDotClass,
  syncStateLabel,
  useVaultStatus,
} from "./vault-hooks";

function SyncStatus({ onSyncNow }: { onSyncNow: () => void }) {
  const statusQuery = useVaultStatus();
  const status = statusQuery.data;
  if (status === undefined) {
    return null;
  }
  const canSync = canSyncNow(status);
  return (
    <button
      type="button"
      disabled={!canSync}
      title={status.lastError ?? syncBlockedReason(status) ?? "Sync now"}
      onClick={onSyncNow}
      className={cn("flex items-center gap-1.5 px-1", canSync && "hover:text-foreground")}
    >
      <span className={cn("size-1.5 rounded-full", syncStateDotClass(status))} />
      {syncStateLabel(status)}
    </button>
  );
}

// The strip across the window's bottom: ambient state that belongs to no one surface. Sync
// on the left; the open note's count, the agent's state, deleted notes and Settings on the
// right. The count is what the serializer published, never a recount.
export function StatusBar({
  path,
  onSyncNow,
  onOpenDeletedNotes,
  onOpenSettings,
}: {
  path: string | null;
  onSyncNow: () => void;
  onOpenDeletedNotes: () => void;
  onOpenSettings: () => void;
}) {
  const stats = useNoteStats(path);
  const threadsQuery = useThreads();
  const agentWorking = (threadsQuery.data?.threads ?? []).some(
    (thread) =>
      thread.status === "active" || thread.status === "starting" || thread.status === "stopping",
  );
  return (
    <footer className="flex h-[var(--app-status-h)] shrink-0 items-center gap-2 border-t border-line px-1.5 text-xs text-muted-foreground print:hidden">
      <SyncStatus onSyncNow={onSyncNow} />
      <div className="ml-auto flex items-center gap-2">
        {agentWorking ? (
          <span className="flex items-center gap-1">
            <Spinner className="size-3" />
            Agent working
          </span>
        ) : null}
        {stats === null ? null : (
          <span className="tabular-nums">
            {plural(stats.words, "word")} · {readingTimeLabel(stats.words)}
          </span>
        )}
        <Button
          variant="ghost"
          size="icon-compact"
          className="size-5"
          aria-label="Deleted notes"
          onClick={onOpenDeletedNotes}
        >
          <ArchiveRestoreIcon className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon-compact"
          className="size-5"
          aria-label="Settings"
          onClick={onOpenSettings}
        >
          <SettingsIcon className="size-3.5" />
        </Button>
      </div>
    </footer>
  );
}
