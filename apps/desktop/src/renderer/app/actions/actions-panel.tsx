import { getLiveEditor } from "@repo/editor/live-editor";
import {
  TaskItem,
  TaskItemLabel,
  TaskItemRow,
  TaskList,
  TaskStatusLabel,
  type TaskStatus,
} from "@repo/ui/ai/task-rows";
import { TabsSubtle, TabsSubtleItem } from "@repo/ui/components/tabs-subtle";
import { PropertiesPanel } from "@repo/editor/properties/properties-panel";
import type { Thread } from "@repo/api/local/threads/threads-schema";
import { Button } from "@repo/ui/components/button";
import { Textarea } from "@repo/ui/components/textarea";
import { toast } from "@repo/ui/components/sonner";
import { cn } from "@repo/ui/lib/utils";
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  ArrowLeftIcon,
  ChevronRightIcon,
  Trash2Icon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { orpc } from "../api";
import { ApprovalCard } from "./approval-card";
import { THREAD_ACTIVITY_LABELS, threadActivity, type ThreadActivity } from "../thread-activity";
import { sendToThread } from "./send-to-thread";
import { useThreadDetail, useThreads, useThreadTimeline } from "./thread-hooks";
import { RelatedInline } from "./related-section";
import { CommentsTab } from "./comments-tab";
import { HistoryTab } from "./history-tab";
import { TimelineRowView } from "./timeline-rows";
import { useWorkspace } from "../workspace-context";

export type PanelTab = "actions" | "comments" | "history" | "metadata";

const PANEL_TABS: readonly PanelTab[] = ["actions", "comments", "history", "metadata"];
const PANEL_TAB_LABELS = {
  actions: "Actions",
  comments: "Comments",
  history: "History",
  metadata: "Metadata",
} satisfies Record<PanelTab, string>;

// the note's own buttons: deleting it, and the list a deleted note comes back from
interface NoteMetadataActions {
  deleteNote: () => void;
  openDeletedNotes: () => void;
}

export interface ActionsPanelProps {
  docPath: string | null;
  tab: PanelTab;
  onTabChange: (tab: PanelTab) => void;
  // the nonce distinguishes two clicks on the same range.
  commentFocus: { ids: readonly string[]; nonce: number } | null;
  selectedThreadId: string | null;
  onSelectThread: (threadId: string | null) => void;
  onOpenDoc: (path: string) => void;
  noteMetadata: NoteMetadataActions;
}

function InlineProperties({
  docPath,
  open,
  onOpenChange,
}: {
  docPath: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const editor = open ? getLiveEditor(docPath) : null;
  return (
    <div className="shrink-0 border-b border-line">
      <button
        type="button"
        aria-expanded={open}
        className="flex w-full items-center gap-1 px-3 py-1.5 text-[11px] font-medium text-muted-foreground uppercase hover:text-foreground"
        onClick={() => {
          onOpenChange(!open);
        }}
      >
        <ChevronRightIcon className={cn("size-3 transition-transform", open && "rotate-90")} />
        Properties
      </button>
      {open ? (
        <div className="px-3 pb-2">
          {editor !== null ? (
            <PropertiesPanel editor={editor} />
          ) : (
            <p className="pb-1 text-xs text-muted-foreground">Open the note to edit properties.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}

function NoteMetadataTab({
  docPath,
  propertiesOpen,
  onPropertiesOpenChange,
  onOpenDoc,
  actions,
}: {
  docPath: string | null;
  propertiesOpen: boolean;
  onPropertiesOpenChange: (open: boolean) => void;
  onOpenDoc: (path: string) => void;
  actions: NoteMetadataActions;
}) {
  if (docPath === null) {
    return <p className="p-3 text-sm text-muted-foreground">Open a note to see its metadata.</p>;
  }
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <InlineProperties
        docPath={docPath}
        open={propertiesOpen}
        onOpenChange={onPropertiesOpenChange}
      />
      <RelatedInline docPath={docPath} onOpenDoc={onOpenDoc} />
      <div className="px-3 py-2">
        <p className="pb-1 text-[11px] font-medium text-muted-foreground uppercase">Note</p>
        <div className="-ml-2 flex flex-col items-start">
          <Button
            variant="ghost"
            size="compact"
            leadingIcon={Trash2Icon}
            className="text-destructive hover:text-destructive"
            onClick={actions.deleteNote}
          >
            Delete note
          </Button>
          <Button
            variant="ghost"
            size="compact"
            leadingIcon={ArchiveRestoreIcon}
            onClick={actions.openDeletedNotes}
          >
            Deleted notes…
          </Button>
        </div>
      </div>
    </div>
  );
}

// picks the badge only; the wording stays THREAD_ACTIVITY_LABELS.
const ACTIVITY_TASK_STATUS = {
  running: "running",
  done: "done",
  failed: "failed",
  archived: "done",
} satisfies Record<ThreadActivity, TaskStatus>;

function ActionRow({ thread, onSelect }: { thread: Thread; onSelect: (threadId: string) => void }) {
  const activity = threadActivity(thread);
  return (
    <TaskItem>
      <TaskItemRow
        status={ACTIVITY_TASK_STATUS[activity]}
        onSelect={() => {
          onSelect(thread.id);
        }}
      >
        <TaskItemLabel>{thread.title ?? "Untitled action"}</TaskItemLabel>
        <TaskStatusLabel>{THREAD_ACTIVITY_LABELS[activity]}</TaskStatusLabel>
      </TaskItemRow>
    </TaskItem>
  );
}

function ActionDetail({
  threadId,
  onBack,
  onOpenDoc,
}: {
  threadId: string;
  onBack: () => void;
  onOpenDoc: (path: string) => void;
}) {
  const { api } = useWorkspace();
  const queryClient = useQueryClient();
  const detailQuery = useThreadDetail(threadId);
  const timeline = useThreadTimeline(threadId);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const thread = detailQuery.data?.thread ?? null;
  const pending = detailQuery.data?.pendingInteractions ?? [];
  const rowCount = timeline?.rows.length ?? 0;
  const pendingCount = pending.length;

  useEffect(() => {
    const scroller = scrollRef.current;
    if (scroller === null || rowCount + pendingCount === 0) {
      return;
    }
    scroller.scrollTop = scroller.scrollHeight;
  }, [rowCount, pendingCount]);

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: orpc.threads.key() });
  };

  const submit = (): void => {
    const trimmed = text.trim();
    if (trimmed === "" || sending) {
      return;
    }
    setSending(true);
    void (async () => {
      try {
        const outcome = await sendToThread(api, {
          threadId,
          text: trimmed,
          activeTurnId: detailQuery.data?.thread.activeTurnId ?? null,
        });
        if (outcome.kind === "refused") {
          toast.error(outcome.message);
          return;
        }
        setText("");
      } catch {
        toast.error("Could not reach the agent.");
      } finally {
        setSending(false);
        invalidate();
      }
    })();
  };

  const answerInteraction = (interactionId: string, resolution: string): void => {
    void (async () => {
      try {
        await api.threads.answerInteraction({ interactionId, resolution, threadId });
      } catch {
        toast.error("Could not answer the approval.");
      } finally {
        invalidate();
      }
    })();
  };

  const archive = (): void => {
    void (async () => {
      try {
        await api.threads.archive({ threadId });
        onBack();
      } catch {
        toast.error("Could not archive the action.");
      } finally {
        invalidate();
      }
    })();
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1 border-b border-line px-2 py-1.5 text-sm">
        <Button size="icon-compact" variant="ghost" aria-label="Back to actions" onClick={onBack}>
          <ArrowLeftIcon />
        </Button>
        <span className="min-w-0 flex-1 truncate font-medium">{thread?.title ?? "Action"}</span>
        {thread?.originDocPath !== null && thread?.originDocPath !== undefined ? (
          <button
            type="button"
            className="max-w-32 truncate text-xs text-muted-foreground underline-offset-2 hover:underline"
            onClick={() => {
              onOpenDoc(thread.originDocPath ?? "");
            }}
          >
            {thread.originDocPath}
          </button>
        ) : null}
        <Button size="icon-compact" variant="ghost" aria-label="Archive action" onClick={archive}>
          <ArchiveIcon />
        </Button>
      </div>
      <div ref={scrollRef} className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-2 py-3">
        {timeline?.rows.map((row) => (
          <TimelineRowView key={row.id} row={row} />
        ))}
        {pending.map((interaction) => (
          <ApprovalCard
            key={interaction.id}
            interaction={interaction}
            onAnswer={answerInteraction}
          />
        ))}
      </div>
      <div className="border-t border-line p-2">
        <Textarea
          aria-label="Reply to the agent"
          placeholder="Reply…"
          value={text}
          rows={1}
          className="max-h-32 min-h-9 resize-none"
          onChange={(event) => {
            setText(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
        />
      </div>
    </div>
  );
}

export function ActionsPanel({
  docPath,
  tab,
  onTabChange,
  commentFocus,
  selectedThreadId,
  onSelectThread,
  onOpenDoc,
  noteMetadata,
}: ActionsPanelProps) {
  const [propertiesOpen, setPropertiesOpen] = useState(true);
  const threadsQuery = useThreads();
  const threads = threadsQuery.data?.threads ?? [];

  const noteActions = docPath === null ? [] : threads.filter((t) => t.originDocPath === docPath);
  const otherActions = threads.filter((t) => docPath === null || t.originDocPath !== docPath);

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-[var(--app-header-h)] shrink-0 items-center border-b border-line px-1.5">
        <TabsSubtle
          aria-label="Panel tabs"
          size="compact"
          selectedIndex={PANEL_TABS.indexOf(tab)}
          onSelect={(index) => {
            const next = PANEL_TABS[index];
            if (next !== undefined) onTabChange(next);
          }}
        >
          {PANEL_TABS.map((name, index) => (
            <TabsSubtleItem key={name} index={index} label={PANEL_TAB_LABELS[name]} />
          ))}
        </TabsSubtle>
      </div>

      {tab === "comments" ? (
        <CommentsTab docPath={docPath} focusIds={commentFocus?.ids ?? []} />
      ) : tab === "history" ? (
        <HistoryTab key={docPath} docPath={docPath} />
      ) : tab === "metadata" ? (
        <NoteMetadataTab
          docPath={docPath}
          propertiesOpen={propertiesOpen}
          onPropertiesOpenChange={setPropertiesOpen}
          onOpenDoc={onOpenDoc}
          actions={noteMetadata}
        />
      ) : selectedThreadId !== null ? (
        <ActionDetail
          threadId={selectedThreadId}
          onBack={() => {
            onSelectThread(null);
          }}
          onOpenDoc={onOpenDoc}
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {noteActions.length > 0 ? (
            <>
              <p className="px-2 pt-1 pb-0.5 text-[11px] font-medium text-muted-foreground uppercase">
                This note
              </p>
              <TaskList variant="list">
                {noteActions.map((thread) => (
                  <ActionRow key={thread.id} thread={thread} onSelect={onSelectThread} />
                ))}
              </TaskList>
            </>
          ) : null}
          {otherActions.length > 0 ? (
            <>
              <p className="px-2 pt-2 pb-0.5 text-[11px] font-medium text-muted-foreground uppercase">
                Recent
              </p>
              <TaskList variant="list">
                {otherActions.map((thread) => (
                  <ActionRow key={thread.id} thread={thread} onSelect={onSelectThread} />
                ))}
              </TaskList>
            </>
          ) : null}
          {threads.length === 0 ? (
            <p className="p-3 text-sm text-muted-foreground">
              No actions yet. Press ⌘K to ask the agent.
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}
