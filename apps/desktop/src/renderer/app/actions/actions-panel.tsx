import { useLiveEditor } from "@repo/editor/live-editor";
import {
  TaskItem,
  TaskItemLabel,
  TaskItemRow,
  TaskList,
  TaskStatusLabel,
} from "@repo/ui/ai/task-rows";
import type { TaskStatus } from "@repo/ui/ai/task-rows";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@repo/ui/components/tabs";
import { PropertiesPanel } from "@repo/editor/properties/properties-panel";
import type { TimelineRow } from "@repo/api/local/thread-timeline";
import type { Thread } from "@repo/api/local/threads/threads-schema";
import { isThreadRunning } from "@repo/domain/thread-status";
import { Button } from "@repo/ui/components/button";
import { Textarea } from "@repo/ui/components/textarea";
import { isImeComposing } from "@repo/ui/lib/ime";
import type { ShortcutModifier } from "@repo/ui/lib/hotkey-spelling";
import { toast } from "@repo/ui/components/sonner";
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  ArrowLeftIcon,
  PinIcon,
  PinOffIcon,
  SquareIcon,
  Trash2Icon,
} from "lucide-react";
import { Fragment, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { UseInfiniteQueryResult } from "@tanstack/react-query";

import { useSignedOutHarness } from "../agents/agent-hooks";
import { AgentSignIn } from "../agents/agent-sign-in";
import { client, failed, orpc, safe } from "../api";
import { FoldSection } from "../fold-section";
import { ApprovalCard } from "./approval-card";
import { useFollowBottom } from "./follow-bottom";
import { THREAD_ACTIVITY_LABELS, threadActivity, threadStopControl } from "../thread-activity";
import type { ThreadActivity } from "../thread-activity";
import { sendToThread } from "./send-to-thread";
import {
  useNoteThreads,
  useThreadDetail,
  useThreads,
  useThreadTimeline,
  useTurnChanges,
} from "./thread-hooks";
import { NoteFacts } from "./note-facts";
import { RelatedInline } from "./related-section";
import { CommentsTab } from "./comments-tab";
import type { CommentFocus } from "./comments-tab";
import { HistoryTab } from "./history-tab";
import { ReadRefusal } from "./read-refusal";
import {
  QueuedReplyView,
  TimelineRowView,
  TurnChangesFooter,
  turnFooterSlots,
} from "./timeline-rows";
import type { TurnUndoState } from "./timeline-rows";
import { reportUndo, undoTurnChanges } from "./undo-turn";
import { usePinnedPaths } from "../vault-hooks";
import { bindingFor } from "../global-shortcuts";

export type PanelTab = "actions" | "comments" | "history" | "metadata";

const PANEL_TABS: readonly PanelTab[] = ["actions", "comments", "history", "metadata"];
const PANEL_TAB_LABELS = {
  actions: "Actions",
  comments: "Comments",
  history: "History",
  metadata: "Metadata",
} satisfies Record<PanelTab, string>;

// the note's own buttons: pinning it, deleting it, and the list a deleted note comes back from
interface NoteMetadataActions {
  setPinned: (pinned: boolean) => void;
  deleteNote: () => void;
  openDeletedNotes: () => void;
}

export interface ActionsPanelProps {
  docPath: string | null;
  // the keyboard the workspace listens with, so the empty states spell its chords
  modifier: ShortcutModifier;
  tab: PanelTab;
  onTabChange: (tab: PanelTab) => void;
  commentFocus: CommentFocus | null;
  selectedThreadId: string | null;
  onSelectThread: (threadId: string | null) => void;
  onOpenDoc: (path: string) => void;
  noteMetadata: NoteMetadataActions;
}

export const InlineProperties = ({
  docPath,
  open,
  onOpenChange,
}: {
  docPath: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) => {
  const editor = useLiveEditor(open ? docPath : null);
  return (
    <FoldSection label="Properties" open={open} onOpenChange={onOpenChange}>
      <div className="px-3 pb-2">
        {editor === null ? (
          <p className="pb-1 text-body text-muted-foreground">Open the note to edit properties.</p>
        ) : (
          <PropertiesPanel editor={editor} />
        )}
      </div>
    </FoldSection>
  );
};

const NoteMetadataTab = ({
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
}) => {
  const pinnedPaths = usePinnedPaths();
  const pinned = docPath !== null && pinnedPaths.has(docPath);
  const { deleteNote, openDeletedNotes } = actions;
  if (docPath === null) {
    return (
      <p className="p-3 text-subtitle text-muted-foreground">Open a note to see its metadata.</p>
    );
  }
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <InlineProperties
        docPath={docPath}
        open={propertiesOpen}
        onOpenChange={onPropertiesOpenChange}
      />
      <RelatedInline docPath={docPath} onOpenDoc={onOpenDoc} />
      <NoteFacts docPath={docPath} />
      <div className="px-3 py-2">
        <p className="pb-1 text-caption font-medium text-muted-foreground uppercase">Note</p>
        <div className="-ml-2 flex flex-col items-start">
          <Button
            variant="ghost"
            size="compact"
            leadingIcon={pinned ? PinOffIcon : PinIcon}
            onClick={() => {
              actions.setPinned(!pinned);
            }}
          >
            {pinned ? "Unpin note" : "Pin note"}
          </Button>
          <Button
            variant="ghost"
            size="compact"
            leadingIcon={Trash2Icon}
            className="text-destructive hover:text-destructive"
            onClick={deleteNote}
          >
            Delete note
          </Button>
          <Button
            variant="ghost"
            size="compact"
            leadingIcon={ArchiveRestoreIcon}
            onClick={openDeletedNotes}
          >
            Deleted notes…
          </Button>
        </div>
      </div>
    </div>
  );
};

// ⌘K would open on the sign-in while the default agent is signed out, so the list offers it here.
const NoActionsYet = ({ modifier }: { modifier: ShortcutModifier }) =>
  useSignedOutHarness(null) === null ? (
    <p className="p-3 text-subtitle text-muted-foreground">
      No actions yet. Press {bindingFor("open-action-composer", modifier)} to ask the agent.
    </p>
  ) : (
    <div className="space-y-3 p-3">
      <p className="text-subtitle text-muted-foreground">
        No actions yet. Sign in to ask the agent to work on your notes.
      </p>
      <AgentSignIn />
    </div>
  );

// picks the badge only; the wording stays THREAD_ACTIVITY_LABELS.
const ACTIVITY_TASK_STATUS = {
  archived: "done",
  done: "done",
  failed: "failed",
  running: "running",
} satisfies Record<ThreadActivity, TaskStatus>;

const ActionRow = ({
  thread,
  onSelect,
}: {
  thread: Thread;
  onSelect: (threadId: string) => void;
}) => {
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
};

const ShowMoreActions = ({
  pages,
  label,
}: {
  pages: Pick<UseInfiniteQueryResult, "fetchNextPage" | "hasNextPage" | "isFetchingNextPage">;
  label: string;
}) =>
  pages.hasNextPage ? (
    <div className="px-2 py-1">
      <Button
        variant="ghost"
        size="compact"
        aria-label={label}
        disabled={pages.isFetchingNextPage}
        onClick={() => {
          void pages.fetchNextPage();
        }}
      >
        Show more
      </Button>
    </div>
  ) : null;

// each settled reply ends with what its turn changed
const TranscriptRows = ({
  threadId,
  thread,
  rows,
  onShowHistory,
}: {
  threadId: string;
  // null until the thread's detail is read
  thread: Thread | null;
  rows: readonly TimelineRow[];
  onShowHistory: (path: string) => void;
}) => {
  const canUndo = thread !== null && !isThreadRunning(thread.status);
  const queryClient = useQueryClient();
  const turnChanges = useTurnChanges(threadId);
  const changesByTurn = new Map((turnChanges.data?.turns ?? []).map((turn) => [turn.turnId, turn]));
  const footerSlots = turnFooterSlots(rows);

  // settles once the thread's changes are read again, so the footer goes from pending to undone
  // without offering the undo a second time in between.
  const undoTurn = useMutation({
    mutationFn: async (turnId: string) => await undoTurnChanges(client, { threadId, turnId }),
    onSuccess: async (outcome) => {
      reportUndo(outcome, onShowHistory);
      await queryClient.invalidateQueries({
        queryKey: orpc.threads.turnChanges.key({ input: { threadId } }),
      });
    },
  });
  const undoStateOf = (turnId: string): TurnUndoState => {
    if (!canUndo) {
      return "withheld";
    }
    return undoTurn.isPending && undoTurn.variables === turnId ? "pending" : "offered";
  };
  const undo = (turnId: string): void => {
    undoTurn.mutate(turnId);
  };

  return rows.map((row) => {
    const endedTurn = footerSlots.get(row.id);
    return (
      <Fragment key={row.id}>
        <TimelineRowView row={row} />
        {endedTurn === undefined ? null : (
          <TurnChangesFooter
            status={endedTurn.status}
            changes={changesByTurn.get(endedTurn.turnId)}
            undo={undoStateOf(endedTurn.turnId)}
            onUndo={undo}
          />
        )}
      </Fragment>
    );
  });
};

// A thread not started yet runs on the default; one another device runs needs nothing from here.
// null is a thread not read yet.
const SignInBanner = ({ thread }: { thread: Thread | null }) => {
  const signedOut = useSignedOutHarness(thread?.providerId ?? null);
  if (thread === null || signedOut === null || thread.runsElsewhere) {
    return null;
  }
  return (
    <div className="space-y-2 border-t border-line px-3 py-2">
      <p className="text-body">{signedOut.displayName} is signed out on this Mac.</p>
      <AgentSignIn harness={signedOut.id} />
    </div>
  );
};

const ActionDetail = ({
  threadId,
  onBack,
  onOpenDoc,
  onShowHistory,
}: {
  threadId: string;
  onBack: () => void;
  onOpenDoc: (path: string) => void;
  onShowHistory: (path: string) => void;
}) => {
  const queryClient = useQueryClient();
  const detailQuery = useThreadDetail(threadId);
  const transcript = useThreadTimeline(threadId);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const { contentRef, onScroll, scrollRef } = useFollowBottom();

  const thread = detailQuery.data?.thread ?? null;
  const pending = detailQuery.data?.pendingInteractions ?? [];
  const queued = detailQuery.data?.queuedMessages ?? [];

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
        const outcome = await sendToThread(client, {
          activeTurnId: detailQuery.data?.thread.activeTurnId ?? null,
          text: trimmed,
          threadId,
        });
        if (outcome.kind === "refused") {
          toast.error(outcome.message);
        } else {
          setText("");
        }
      } catch (error) {
        failed(error, "Could not reach the agent.");
      }
      setSending(false);
      invalidate();
    })();
  };

  // rethrown so the card hands its options back for another try
  const answerInteraction = async (interactionId: string, resolution: string): Promise<void> => {
    const { error } = await safe(
      client.threads.answerInteraction({ interactionId, resolution, threadId }),
    );
    invalidate();
    if (error !== null) {
      failed(error, "Could not answer the approval.");
      throw error;
    }
  };

  const archive = (): void => {
    void (async () => {
      try {
        await client.threads.archive({ threadId });
        onBack();
      } catch (error) {
        failed(error, "Could not archive the action.");
      }
      invalidate();
    })();
  };

  const stopControl = thread === null ? "none" : threadStopControl(thread);

  const stop = (): void => {
    void (async () => {
      const { error } = await safe(client.threads.interrupt({ threadId }));
      if (error !== null) {
        failed(error, "Could not stop the action.");
      }
      invalidate();
    })();
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1 border-b border-line px-2 py-1.5 text-subtitle">
        <Button size="icon-compact" variant="ghost" aria-label="Back to actions" onClick={onBack}>
          <ArrowLeftIcon />
        </Button>
        <span className="min-w-0 flex-1 truncate font-medium">{thread?.title ?? "Action"}</span>
        {thread?.originDocPath !== null && thread?.originDocPath !== undefined ? (
          <button
            type="button"
            className="max-w-32 truncate text-body text-muted-foreground underline-offset-2 hover:underline"
            onClick={() => {
              onOpenDoc(thread.originDocPath ?? "");
            }}
          >
            {thread.originDocPath}
          </button>
        ) : null}
        {thread?.runsElsewhere === true ? (
          <span className="shrink-0 px-1 text-caption text-muted-foreground">
            Running on another device
          </span>
        ) : null}
        {stopControl === "none" ? null : (
          <Button
            size="icon-compact"
            variant="ghost"
            aria-label={stopControl === "requested" ? "Stopping action" : "Stop action"}
            disabled={stopControl === "requested"}
            onClick={stop}
          >
            <SquareIcon />
          </Button>
        )}
        <Button size="icon-compact" variant="ghost" aria-label="Archive action" onClick={archive}>
          <ArchiveIcon />
        </Button>
      </div>
      <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
        <div ref={contentRef} className="flex flex-col gap-3">
          {transcript.state === "refused" ? (
            <ReadRefusal lead="The transcript could not be read." error={transcript.error} />
          ) : null}
          {transcript.state === "read" ? (
            <TranscriptRows
              threadId={threadId}
              rows={transcript.timeline.rows}
              thread={thread}
              onShowHistory={onShowHistory}
            />
          ) : null}
          {queued.map((message) => (
            <QueuedReplyView key={message.id} text={message.text} />
          ))}
          {pending.map((interaction) => (
            <ApprovalCard
              key={interaction.id}
              interaction={interaction}
              onAnswer={answerInteraction}
            />
          ))}
        </div>
      </div>
      <SignInBanner thread={thread} />
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
            if (isImeComposing(event)) {
              return;
            }
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
        />
      </div>
    </div>
  );
};

export const ActionsPanel = ({
  docPath,
  tab,
  onTabChange,
  commentFocus,
  selectedThreadId,
  onSelectThread,
  onOpenDoc,
  noteMetadata,
  modifier,
}: ActionsPanelProps) => {
  const [propertiesOpen, setPropertiesOpen] = useState(true);
  const recentQuery = useThreads();
  const noteQuery = useNoteThreads(docPath);
  const recent = recentQuery.data ?? [];
  const noteActions = noteQuery.data ?? [];
  const otherActions = recent.filter((t) => docPath === null || t.originDocPath !== docPath);

  return (
    <Tabs
      value={tab}
      onValueChange={(value) => {
        const next = PANEL_TABS.find((name) => name === value);
        if (next !== undefined) {
          onTabChange(next);
        }
      }}
      className="h-full"
    >
      <div className="flex h-[var(--app-header-h)] shrink-0 items-center border-b border-line px-1.5">
        <TabsList aria-label="Panel tabs">
          {PANEL_TABS.map((name) => (
            <TabsTrigger key={name} value={name}>
              {PANEL_TAB_LABELS[name]}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
      <TabsContent value="comments">
        <CommentsTab docPath={docPath} focus={commentFocus} modifier={modifier} />
      </TabsContent>
      <TabsContent value="history">
        <HistoryTab key={docPath} docPath={docPath} />
      </TabsContent>
      <TabsContent value="metadata">
        <NoteMetadataTab
          docPath={docPath}
          propertiesOpen={propertiesOpen}
          onPropertiesOpenChange={setPropertiesOpen}
          onOpenDoc={onOpenDoc}
          actions={noteMetadata}
        />
      </TabsContent>
      <TabsContent value="actions">
        {selectedThreadId === null ? (
          <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
            {noteActions.length > 0 ? (
              <>
                <p className="px-2 pt-1 pb-0.5 text-caption font-medium text-muted-foreground uppercase">
                  This note
                </p>
                <TaskList variant="list">
                  {noteActions.map((thread) => (
                    <ActionRow key={thread.id} thread={thread} onSelect={onSelectThread} />
                  ))}
                </TaskList>
                <ShowMoreActions pages={noteQuery} label="Show more for this note" />
              </>
            ) : null}
            {otherActions.length > 0 || recentQuery.hasNextPage ? (
              <>
                <p className="px-2 pt-2 pb-0.5 text-caption font-medium text-muted-foreground uppercase">
                  Recent
                </p>
                <TaskList variant="list">
                  {otherActions.map((thread) => (
                    <ActionRow key={thread.id} thread={thread} onSelect={onSelectThread} />
                  ))}
                </TaskList>
                <ShowMoreActions pages={recentQuery} label="Show more recent actions" />
              </>
            ) : null}
            {recent.length === 0 && noteActions.length === 0 ? (
              <NoActionsYet modifier={modifier} />
            ) : null}
          </div>
        ) : (
          <ActionDetail
            key={selectedThreadId}
            threadId={selectedThreadId}
            onBack={() => {
              onSelectThread(null);
            }}
            onOpenDoc={onOpenDoc}
            onShowHistory={(path) => {
              onOpenDoc(path);
              onTabChange("history");
            }}
          />
        )}
      </TabsContent>
    </Tabs>
  );
};
