import {
  TaskItem,
  TaskItemLabel,
  TaskItemRow,
  TaskList,
  TaskStatusLabel,
} from "@repo/ui/ai/task-rows";
import type { TaskStatus } from "@repo/ui/ai/task-rows";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@repo/ui/components/tabs";
import type { Thread } from "@repo/contract/local/threads/threads-schema";
import { Button } from "@repo/ui/components/button";
import { Textarea } from "@repo/ui/components/textarea";
import { isImeComposing } from "@repo/ui/lib/ime";
import type { ShortcutModifier } from "@repo/ui/lib/hotkey-spelling";
import { toast } from "@repo/ui/components/sonner";
import { ArchiveIcon, ArrowLeftIcon, SquareIcon } from "lucide-react";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { UseInfiniteQueryResult } from "@tanstack/react-query";

import { client, failed, orpc, safe } from "../api";
import { ApprovalCard } from "./approval-card";
import { useFollowBottom } from "./follow-bottom";
import { THREAD_ACTIVITY_LABELS, threadActivity, threadStopControl } from "../thread-activity";
import type { ThreadActivity } from "../thread-activity";
import { sendToThread } from "./send-to-thread";
import { useThreadDetail, useThreads, useThreadTimeline } from "./thread-hooks";
import { ReadRefusal } from "./read-refusal";
import { QueuedReplyView, TimelineRowView } from "./timeline-rows";
import { bindingFor } from "../global-shortcuts";

export type PanelTab = "actions";

const PANEL_TABS: readonly PanelTab[] = ["actions"];
const PANEL_TAB_LABELS = {
  actions: "Actions",
} satisfies Record<PanelTab, string>;

export interface ActionsPanelProps {
  // the keyboard the workspace listens with, so the empty states spell its chords
  modifier: ShortcutModifier;
  tab: PanelTab;
  onTabChange: (tab: PanelTab) => void;
  selectedThreadId: string | null;
  onSelectThread: (threadId: string | null) => void;
}

const NoActionsYet = ({ modifier }: { modifier: ShortcutModifier }) => (
  <p className="p-3 text-subtitle text-muted-foreground">
    No actions yet. Press {bindingFor("open-action-composer", modifier)} to ask the agent.
  </p>
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

const ActionDetail = ({ threadId, onBack }: { threadId: string; onBack: () => void }) => {
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
          {transcript.state === "read"
            ? transcript.timeline.rows.map((row) => <TimelineRowView key={row.id} row={row} />)
            : null}
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
  tab,
  onTabChange,
  selectedThreadId,
  onSelectThread,
  modifier,
}: ActionsPanelProps) => {
  const recentQuery = useThreads();
  const recent = recentQuery.data ?? [];

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
      <TabsContent value="actions">
        {selectedThreadId === null ? (
          <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
            {recent.length > 0 || recentQuery.hasNextPage ? (
              <>
                <TaskList variant="list">
                  {recent.map((thread) => (
                    <ActionRow key={thread.id} thread={thread} onSelect={onSelectThread} />
                  ))}
                </TaskList>
                <ShowMoreActions pages={recentQuery} label="Show more actions" />
              </>
            ) : (
              <NoActionsYet modifier={modifier} />
            )}
          </div>
        ) : (
          <ActionDetail
            key={selectedThreadId}
            threadId={selectedThreadId}
            onBack={() => {
              onSelectThread(null);
            }}
          />
        )}
      </TabsContent>
    </Tabs>
  );
};
