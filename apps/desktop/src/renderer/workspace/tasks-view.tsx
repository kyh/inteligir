// The whole-vault tasks view — an alternate main surface like the graph,
// launched from the palette. Rows come from the knowledge projection
// (listVaultTasks) and refresh on onKnowledgeUpdated; scheduling + grouping
// run RENDERER-side through core's pure groupTasks (this side owns the
// Settings → Notes daily config via useDiskState). Toggling goes through the
// guarded host channel — flush-first when the row's note is the OPEN note —
// and any {ok:false} refusal toasts + refetches (the host already kicked the
// index self-heal). Delegation rows reuse the existing store keyed by
// (sourceFile, ordinal); Esc returns to the editor (graph parity).

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircleIcon,
  CheckIcon,
  ChevronRightIcon,
  Clock3Icon,
  Loader2Icon,
  RotateCwIcon,
  SparklesIcon,
  XIcon,
} from "lucide-react";

import { Button } from "@repo/ui/components/button";
import { toast } from "@repo/ui/components/sonner";

import type { VaultTaskEntry } from "@repo/domain/knowledge/link-graph-index";
import { groupTasks } from "@repo/domain/knowledge/task-schedule";
import { formatIsoDate } from "@repo/domain/notes/daily-path";
import {
  DAILY_FOLDER_KEY,
  DAILY_FORMAT_KEY,
  DEFAULT_DAILY_FOLDER,
  DEFAULT_DAILY_FORMAT,
} from "@repo/bridge/daily-notes";
import type { Delegation } from "@repo/bridge/delegation";

import { getBridge } from "@renderer/lib/bridge";
import { useDiskState } from "@renderer/lib/use-disk-state";
import { findDelegation, useDelegationStore } from "@renderer/stores/delegation-store";
import { useViewStore } from "@renderer/stores/view-store";
import { openDocPath } from "@renderer/workspace/open-doc";
import { useVault } from "@renderer/workspace/vault-context";

const parseString = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

/** Group a bucket's rows by their note, input order preserved. */
function byNote(
  tasks: VaultTaskEntry[],
): Array<{ path: string; title: string; rows: VaultTaskEntry[] }> {
  const groups: Array<{ path: string; title: string; rows: VaultTaskEntry[] }> = [];
  const index = new Map<string, number>();
  for (const task of tasks) {
    const at = index.get(task.path);
    if (at === undefined) {
      index.set(task.path, groups.length);
      groups.push({ path: task.path, title: task.title, rows: [task] });
    } else {
      groups[at]?.rows.push(task);
    }
  }
  return groups;
}

export default function TasksView() {
  const setSurface = useViewStore((s) => s.setSurface);
  const { openDoc, openFile, flush } = useVault();
  const openPath = openDocPath(openDoc);
  const delegations = useDelegationStore((s) => s.delegations);
  const delegate = useDelegationStore((s) => s.delegate);
  const cancel = useDelegationStore((s) => s.cancel);

  const [entries, setEntries] = useState<VaultTaskEntry[] | null>(null);
  const [completedOpen, setCompletedOpen] = useState(false);

  const refetch = useCallback(() => {
    getBridge()
      .listVaultTasks()
      .then(setEntries)
      .catch(() => {});
  }, []);

  useEffect(() => {
    refetch();
    return getBridge().onKnowledgeUpdated(() => refetch());
  }, [refetch]);

  // Esc returns to the editor, exactly like the graph surface.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSurface("editor");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setSurface]);

  const [dailyFolder] = useDiskState(DAILY_FOLDER_KEY, DEFAULT_DAILY_FOLDER, parseString);
  const [dailyFormat] = useDiskState(DAILY_FORMAT_KEY, DEFAULT_DAILY_FORMAT, parseString);

  const groups = useMemo(
    () => groupTasks(entries ?? [], { dailyFolder, dailyFormat }, formatIsoDate(new Date())),
    [entries, dailyFolder, dailyFormat],
  );

  /** Flush-first rule (todo-delegation's): when the row's note is the OPEN
   * note, its unsaved buffer must reach disk before the host reads the file —
   * otherwise the on-disk resolve races the buffer. */
  const settleOpenNote = useCallback(
    async (path: string): Promise<boolean> => {
      if (path !== openPath) return true;
      if (await flush()) return true;
      toast.error("Couldn't save the open note — resolve that first.");
      return false;
    },
    [openPath, flush],
  );

  const handleToggle = useCallback(
    async (task: VaultTaskEntry) => {
      if (!(await settleOpenNote(task.path))) return;
      const result = await getBridge()
        .toggleVaultTask({ path: task.path, ordinal: task.ordinal, expectedRaw: task.raw })
        .catch(() => null);
      if (result === null) {
        toast.error("Couldn't toggle that task.");
        return;
      }
      if (!result.ok) {
        // The host refused (stale row) and already kicked an index refresh.
        toast.error("Note changed — task list refreshed");
        refetch();
        return;
      }
      // Optimistic flip; the write's knowledge refresh confirms right after.
      setEntries((prev) =>
        prev === null
          ? prev
          : prev.map((t) =>
              t.path === task.path && t.ordinal === task.ordinal
                ? { ...t, checked: result.checked }
                : t,
            ),
      );
    },
    [refetch, settleOpenNote],
  );

  const handleDelegate = useCallback(
    async (task: VaultTaskEntry) => {
      if (!(await settleOpenNote(task.path))) return;
      const result = await delegate(task.path, task.ordinal);
      if (!result.ok) toast.error(result.error ?? "Couldn't delegate that task.");
    },
    [delegate, settleOpenNote],
  );

  const openNote = useCallback((path: string) => openFile(path), [openFile]);

  const scheduledEmpty =
    groups.overdue.length === 0 && groups.today.length === 0 && groups.upcoming.length === 0;
  const allEmpty =
    scheduledEmpty && groups.unscheduled.length === 0 && groups.completed.length === 0;

  return (
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col gap-6 overflow-auto px-8 py-8">
      <h1 className="text-lg font-semibold">Tasks</h1>

      {entries !== null && allEmpty && (
        <p className="text-sm text-muted-foreground">
          No tasks yet — any <span className="font-mono">- [ ]</span> checkbox in the vault shows up
          here.
        </p>
      )}

      <TaskSection
        heading="Overdue"
        tone="text-destructive"
        rows={groups.overdue}
        showDate
        {...{ delegations, handleToggle, handleDelegate, openNote, cancel }}
      />
      <TaskSection
        heading="Today"
        rows={groups.today}
        {...{ delegations, handleToggle, handleDelegate, openNote, cancel }}
      />
      <TaskSection
        heading="Upcoming"
        rows={groups.upcoming}
        showDate
        {...{ delegations, handleToggle, handleDelegate, openNote, cancel }}
      />

      {groups.unscheduled.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Unscheduled
          </h2>
          {byNote(groups.unscheduled).map((note) => (
            <div key={note.path} className="flex flex-col gap-1">
              <button
                type="button"
                onClick={() => openNote(note.path)}
                className="self-start text-xs font-medium text-muted-foreground hover:text-foreground hover:underline"
                title={note.path}
              >
                {note.title}
              </button>
              {note.rows.map((task) => (
                <TaskRow
                  key={`${task.path}\0${task.ordinal}`}
                  task={task}
                  delegation={findDelegation(delegations, task.path, task.ordinal)}
                  onToggle={handleToggle}
                  onDelegate={handleDelegate}
                  onCancel={cancel}
                />
              ))}
            </div>
          ))}
        </section>
      )}

      {groups.completed.length > 0 && (
        <section className="flex flex-col gap-2 pb-8">
          <button
            type="button"
            onClick={() => setCompletedOpen((open) => !open)}
            aria-expanded={completedOpen}
            className="flex items-center gap-1 self-start text-xs font-medium tracking-wide text-muted-foreground uppercase hover:text-foreground"
          >
            <ChevronRightIcon
              className={`size-3 transition-transform ${completedOpen ? "rotate-90" : ""}`}
            />
            Completed ({groups.completed.length})
          </button>
          {completedOpen &&
            groups.completed.map((task) => (
              <TaskRow
                key={`${task.path}\0${task.ordinal}`}
                task={task}
                showNote
                delegation={null}
                onToggle={handleToggle}
                onDelegate={handleDelegate}
                onCancel={cancel}
                onOpenNote={openNote}
              />
            ))}
        </section>
      )}
    </div>
  );
}

function TaskSection({
  heading,
  tone,
  rows,
  showDate,
  delegations,
  handleToggle,
  handleDelegate,
  openNote,
  cancel,
}: {
  heading: string;
  tone?: string;
  rows: Array<VaultTaskEntry & { date: string }>;
  showDate?: boolean;
  delegations: Delegation[];
  handleToggle: (task: VaultTaskEntry) => Promise<void>;
  handleDelegate: (task: VaultTaskEntry) => Promise<void>;
  openNote: (path: string) => void;
  cancel: (id: string) => void;
}) {
  if (rows.length === 0) return null;
  return (
    <section className="flex flex-col gap-1">
      <h2
        className={`text-xs font-medium tracking-wide uppercase ${tone ?? "text-muted-foreground"}`}
      >
        {heading}
      </h2>
      {rows.map((task) => (
        <TaskRow
          key={`${task.path}\0${task.ordinal}`}
          task={task}
          date={showDate === true ? task.date : undefined}
          showNote
          delegation={findDelegation(delegations, task.path, task.ordinal)}
          onToggle={handleToggle}
          onDelegate={handleDelegate}
          onCancel={cancel}
          onOpenNote={openNote}
        />
      ))}
    </section>
  );
}

function TaskRow({
  task,
  date,
  showNote,
  delegation,
  onToggle,
  onDelegate,
  onCancel,
  onOpenNote,
}: {
  task: VaultTaskEntry;
  date?: string | undefined;
  showNote?: boolean;
  delegation: Delegation | null;
  onToggle: (task: VaultTaskEntry) => Promise<void>;
  onDelegate: (task: VaultTaskEntry) => Promise<void>;
  onCancel: (id: string) => void;
  onOpenNote?: (path: string) => void;
}) {
  return (
    <div className="group flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-muted/50">
      <button
        type="button"
        role="checkbox"
        aria-checked={task.checked}
        aria-label={task.checked ? "Mark task not done" : "Mark task done"}
        onClick={() => void onToggle(task)}
        className={`flex size-4 shrink-0 items-center justify-center rounded-sm border ${
          task.checked
            ? "border-primary bg-primary text-primary-foreground"
            : "border-muted-foreground/40 hover:border-foreground"
        }`}
      >
        {task.checked && <CheckIcon className="size-3" />}
      </button>
      <span
        className={`min-w-0 flex-1 truncate text-sm ${
          task.checked ? "text-muted-foreground line-through" : ""
        }`}
        title={task.text}
      >
        {task.text}
      </span>
      {date !== undefined && (
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{date}</span>
      )}
      {showNote === true && onOpenNote !== undefined && (
        <button
          type="button"
          onClick={() => onOpenNote(task.path)}
          className="max-w-40 shrink-0 truncate rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"
          title={task.path}
        >
          {task.title}
        </button>
      )}
      {delegation !== null && isActiveDelegation(delegation) ? (
        <DelegationBadge
          delegation={delegation}
          onCancel={onCancel}
          onRetry={() => void onDelegate(task)}
        />
      ) : (
        !task.checked && (
          <Button
            variant="ghost"
            size="xs"
            onClick={() => void onDelegate(task)}
            title="Delegate this task to an agent"
            className="h-auto shrink-0 rounded-full px-2 py-0.5 text-[10px] font-normal text-muted-foreground opacity-0 group-hover:opacity-100"
          >
            <SparklesIcon className="size-3" />
            Delegate
          </Button>
        )
      )}
    </div>
  );
}

/** A delegation the badge renders — "done" is excluded at the type level:
 * the checked box is the durable done signal and the row flips as soon as
 * the index refreshes, so the badge never sees it. */
type ActiveDelegation = Delegation & { status: Exclude<Delegation["status"], "done"> };

function isActiveDelegation(delegation: Delegation): delegation is ActiveDelegation {
  return delegation.status !== "done";
}

/** Compact inline status (todo-delegation's badge, sized for list rows). */
function DelegationBadge({
  delegation,
  onCancel,
  onRetry,
}: {
  delegation: ActiveDelegation;
  onCancel: (id: string) => void;
  onRetry: () => void;
}) {
  switch (delegation.status) {
    case "queued":
      return (
        <span className="flex shrink-0 items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
          <Clock3Icon className="size-3" />
          Queued
          <button
            type="button"
            aria-label="Cancel delegation"
            onClick={() => onCancel(delegation.id)}
            title="Cancel"
            className="hover:text-foreground"
          >
            <XIcon className="size-3" />
          </button>
        </span>
      );
    case "running":
      return (
        <span className="flex shrink-0 items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] text-primary">
          <Loader2Icon className="size-3 animate-spin" />
          Working…
        </span>
      );
    case "failed":
      return (
        <span
          className="flex shrink-0 items-center gap-1 px-2 py-0.5 text-[10px] text-destructive"
          title={delegation.error ?? "Failed"}
        >
          <AlertCircleIcon className="size-3" />
          Failed
          <button
            type="button"
            aria-label="Retry delegation"
            onClick={onRetry}
            title="Retry delegation"
            className="hover:text-foreground"
          >
            <RotateCwIcon className="size-3" />
          </button>
        </span>
      );
  }
}
