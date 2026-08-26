// The right panel: Actions | Comments tabs over the
// open note, with the frontmatter properties inlined above them. Actions =
// the note's own threads first, then the rest, each row expandable into its
// live timeline with approvals answerable inline — the transcript surface
// the chat dock used to be. The tab is CONTROLLED by the workspace so the
// top bar's comment button can aim the panel.

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
import { ArchiveIcon, ArrowLeftIcon, ChevronRightIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { orpc } from "../api";
import { ApprovalCard } from "../chat/approval-card";
import { THREAD_ACTIVITY_LABELS, threadActivity, type ThreadActivity } from "../chat/chat-model";
import { sendToThread } from "../chat/chat-service";
import { useThreadDetail, useThreads, useThreadTimeline } from "../chat/thread-hooks";
import { useNoteComments } from "./comment-hooks";
import { RelatedInline } from "./related-section";
import { CommentsTab } from "./comments-tab";
import { TimelineRowView } from "../chat/timeline-rows";
import { useWorkspace } from "../workspace-context";

export type PanelTab = "actions" | "comments";

const PANEL_TABS: readonly PanelTab[] = ["actions", "comments"];
const PANEL_TAB_LABELS = {
  actions: "Actions",
  comments: "Comments",
} satisfies Record<PanelTab, string>;

export interface ActionsPanelProps {
  /** The open note — its actions list first. */
  docPath: string | null;
  tab: PanelTab;
  onTabChange: (tab: PanelTab) => void;
  /** A clicked tinted range: switch to Comments and highlight these roots.
   * The nonce distinguishes two clicks on the same range. */
  commentFocus: { ids: readonly string[]; nonce: number } | null;
  /** The action a launch or a palette pick selected; null shows the list. */
  selectedThreadId: string | null;
  onSelectThread: (threadId: string | null) => void;
  onOpenDoc: (path: string) => void;
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
        <div className="max-h-56 overflow-y-auto px-3 pb-2">
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

/** Our seven activities onto the card's four-state visual vocabulary. The
 *  WORDING stays THREAD_ACTIVITY_LABELS — this only picks the badge. An
 *  archived action reads as settled, which is what it is; its pill carries
 *  the difference. */
const ACTIVITY_TASK_STATUS = {
  queued: "pending",
  running: "running",
  "needs-approval": "pending",
  done: "done",
  failed: "failed",
  archived: "done",
} satisfies Record<ThreadActivity, TaskStatus>;

function ActionRow({ thread, onSelect }: { thread: Thread; onSelect: (threadId: string) => void }) {
  const activity = threadActivity(thread, {
    openInteractionCount: 0,
    queuedCount: 0,
  });
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

  useEffect(() => {
    const scroller = scrollRef.current;
    if (scroller !== null) {
      scroller.scrollTop = scroller.scrollHeight;
    }
  }, [rowCount, pending.length]);

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
        <Button size="icon-xs" variant="ghost" aria-label="Back to actions" onClick={onBack}>
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
        <Button size="icon-xs" variant="ghost" aria-label="Archive action" onClick={archive}>
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
}: ActionsPanelProps) {
  // Mounted HERE rather than in the Comments tab: this hook is what pushes
  // the sidecar's id sets into the editor's comment store, and the range
  // tint must be true with any tab selected.
  useNoteComments(docPath);
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

      {docPath !== null ? (
        <InlineProperties
          docPath={docPath}
          open={propertiesOpen}
          onOpenChange={setPropertiesOpen}
        />
      ) : null}
      {docPath !== null ? <RelatedInline docPath={docPath} onOpenDoc={onOpenDoc} /> : null}

      {tab === "comments" ? (
        <CommentsTab docPath={docPath} focusIds={commentFocus?.ids ?? []} />
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
