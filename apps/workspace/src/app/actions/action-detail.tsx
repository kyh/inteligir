import type { TimelineRow } from "@repo/contract/local/thread-timeline";
import type { Thread } from "@repo/contract/local/threads/threads-schema";
import type { PendingInteractionApprovalDecision } from "@repo/domain/pending-interactions";
import { isThreadRunning } from "@repo/domain/thread-status";
import { Button } from "@repo/ui/components/button";
import { Textarea } from "@repo/ui/components/textarea";
import { isImeComposing } from "@repo/ui/lib/ime";
import { toast } from "@repo/ui/components/sonner";
import { ArchiveIcon, ArrowLeftIcon, SquareIcon } from "lucide-react";
import { Fragment, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { useSignedOutHarness } from "../agents/agent-hooks";
import { AgentSignIn } from "../agents/agent-sign-in";
import { client, failed, orpc, safe } from "../api";
import { ApprovalCard } from "./approval-card";
import { useFollowBottom } from "./follow-bottom";
import { threadStopControl } from "../thread-activity";
import { sendToThread } from "./send-to-thread";
import { useThreadDetail, useThreadTimeline, useTurnChanges } from "./thread-hooks";
import { ReadRefusal } from "./read-refusal";
import {
  QueuedReplyView,
  TimelineRowView,
  TurnChangesFooter,
  turnFooterSlots,
} from "./timeline-rows";
import type { TurnUndoState } from "./timeline-rows";
import { reportUndo, undoTurnChanges } from "./undo-turn";

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

// A thread not started yet runs on the default. null is a thread not read yet.
const SignInBanner = ({ thread }: { thread: Thread | null }) => {
  const signedOut = useSignedOutHarness(thread?.providerId ?? null);
  if (thread === null || signedOut === null) {
    return null;
  }
  return (
    <div className="space-y-2 border-t border-line px-3 py-2">
      <p className="text-body">{signedOut.displayName} is signed out on this Mac.</p>
      <AgentSignIn harness={signedOut.id} />
    </div>
  );
};

export const ActionDetail = ({
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

  // what each write here moves, as the bus's tables weigh its kinds (change-batch.ts): this
  // thread's detail and, but for an answer, its row in every list. The transcript reads its own
  // deltas off the bus, and what a turn changed moves only with its commit, so neither is re-read.
  const rereadDetail = (): void => {
    void queryClient.invalidateQueries({
      queryKey: orpc.threads.get.key({ input: { threadId } }),
    });
  };
  const rereadThread = (): void => {
    rereadDetail();
    void queryClient.invalidateQueries({ queryKey: orpc.threads.list.key() });
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
      rereadThread();
    })();
  };

  // rethrown so the card hands its options back for another try
  const answerInteraction = async (
    interactionId: string,
    decision: PendingInteractionApprovalDecision,
  ): Promise<void> => {
    const { error } = await safe(
      client.threads.answerInteraction({ decision, interactionId, threadId }),
    );
    rereadDetail();
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
      rereadThread();
    })();
  };

  const stopControl = thread === null ? "none" : threadStopControl(thread);

  const stop = (): void => {
    void (async () => {
      const { error } = await safe(client.threads.interrupt({ threadId }));
      if (error !== null) {
        failed(error, "Could not stop the action.");
      }
      rereadThread();
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
        <div ref={contentRef} className="flex flex-col gap-3 select-text">
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
