// CLAUDE.md § THE AGENT PANEL IS THE ACCOUNT'S THREADS. The built-in agent's conversations, the
// same on every device: the threads and their stored events come from the replica (so a past one
// reads offline), the reply being written arrives on the socket as previews, and a send, an
// answer to an approval, a stop and an undo go to the cell, so each waits for a connection. A
// message carries the screen it was sent from (the open item, or the grid's scope and selection).

import { composerPlaceholder, quotePassage, sendInput } from "@repo/agent-panel/agent-send";
import type { AgentViewContext } from "@repo/agent-panel/agent-send";
import {
  agentRefusalWords,
  approvalWords,
  endingWords,
  isWorking,
  readsOnly,
  statusWords,
  threadBlocks,
  threadEntries,
  toolWords,
  waitingApprovals,
} from "@repo/agent-panel/thread-entries";
import type { ThreadBlock, ThreadEntry, ToolUse } from "@repo/agent-panel/thread-entries";
import { previewOf } from "@repo/agent-panel/thread-previews";
import {
  changeSetsOf,
  conversationUndo,
  turnUndo,
  undoBatches,
} from "@repo/agent-panel/thread-undo";
import { TIDY_LABEL } from "@repo/agent-panel/tidy-library";
import { ApprovalCard, ApprovalOption, ApprovalQuestion } from "@repo/ui/ai/approval-card";
import type { ApprovalAnswer } from "@repo/ui/ai/approval-card";
import { StreamingText } from "@repo/ui/ai/streaming-text";
import { Thinking, ThinkingReasoning } from "@repo/ui/ai/thinking";
import { ToolChip, ToolChipDetail, ToolChipList } from "@repo/ui/ai/tool-chips";
import { Button } from "@repo/ui/components/button";
import { InputMessage } from "@repo/ui/components/input-message";
import { toast } from "@repo/ui/components/sonner";
import { plural } from "@repo/ui/lib/plural";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeftIcon, PlusIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { historyPages } from "../cloud/history-pages";
import { useReplica, useReplicaQueries, useWire } from "../cloud/library-context";
import { refusalText } from "@repo/contract/cloud/refusal-text";
import { undoSentence } from "../panel/history-tab";
import { relativeTimeLabel, useNow } from "../relative-time";

export interface AgentPanelProps {
  readonly threadId: string | null;
  readonly onThread: (threadId: string | null) => void;
  // the screen the next message leaves from, read as it is sent
  readonly viewContext: () => AgentViewContext | undefined;
  // writes what the open item holds unsaved, so an undo meets the item as the person sees it
  readonly flushOpen: () => Promise<void>;
  // the composer holds Tidy my library's request, until it is sent or dropped
  readonly tidying: boolean;
  readonly onTidyEnd: () => void;
  // a passage the person asked the agent about, waiting for the composer to quote it
  readonly passage: string | null;
  readonly onPassageTaken: () => void;
}

const EntryRow = ({
  entry,
  undo,
}: {
  entry: ThreadEntry;
  undo: (turn: number) => (() => void) | null;
}) => {
  const { event } = entry;
  switch (event.type) {
    case "user.message": {
      return (
        <p className="m-0 self-end rounded-lg bg-muted px-3 py-2 text-body whitespace-pre-wrap select-text">
          {event.text}
        </p>
      );
    }
    case "agent.message": {
      return (
        <StreamingText
          className="select-text"
          text={event.text}
          streaming={false}
          animate={false}
        />
      );
    }
    // a run of work and an asked approval draw as blocks of their own (`threadBlocks`)
    case "agent.progress":
    case "agent.tool_use":
    case "agent.tool_result":
    case "approval.asked": {
      return null;
    }
    case "approval.answered": {
      return (
        <p className="m-0 text-caption text-muted-foreground">
          {event.result === "allow" ? "Allowed." : "Declined."}
        </p>
      );
    }
    case "turn.ended": {
      const words = endingWords(event.reason);
      const run = undo(event.turn);
      return (
        <div className="flex items-center gap-2" data-turn-ended={event.turn}>
          {words === "" ? null : <p className="m-0 text-caption text-muted-foreground">{words}</p>}
          {run === null ? null : (
            <Button size="compact" variant="ghost" onClick={run}>
              Undo this turn
            </Button>
          )}
        </div>
      );
    }
    // no default
  }
};

const ToolRow = ({ use }: { use: ToolUse }) => (
  <ToolChip
    icon={readsOnly(use.name) ? "read" : "write"}
    label={toolWords(use.name)}
    chip={use.answered ? "" : "…"}
    failed={use.failure !== null}
  >
    {use.failure === null ? null : <ToolChipDetail>{use.failure}</ToolChipDetail>}
  </ToolChip>
);

// the agent's work between two messages: its notes, then the calls it made
const WorkBlock = ({
  block,
  live,
}: {
  block: Extract<ThreadBlock, { kind: "work" }>;
  live: boolean;
}) => (
  <Thinking
    label={block.notes.at(-1)?.text ?? "Working"}
    doneLabel={
      block.uses.length === 0
        ? "Thought it through"
        : `Worked through ${plural(block.uses.length, "step")}`
    }
    working={live}
    data-agent-work
  >
    {block.notes.map((note) => (
      <ThinkingReasoning key={note.eventId}>{note.text}</ThinkingReasoning>
    ))}
    {block.uses.length === 0 ? null : (
      <ToolChipList summary={plural(block.uses.length, "library call")}>
        {block.uses.map((use) => (
          <ToolRow key={use.toolUseId} use={use} />
        ))}
      </ToolChipList>
    )}
  </Thinking>
);

const ThreadList = ({ onThread }: { onThread: (threadId: string | null) => void }) => {
  const threads = useQuery(useReplicaQueries().threads()).data ?? [];
  const nowMs = useNow();
  if (threads.length === 0) {
    return (
      <p className="m-0 px-3 py-2 text-body text-muted-foreground">
        Ask the agent to file, tag, find or summarize what you have saved.
      </p>
    );
  }
  return (
    <ul className="m-0 flex list-none flex-col p-1" aria-label="Conversations">
      {threads
        .toSorted((a, b) => b.updatedAt - a.updatedAt)
        .map((thread) => (
          <li key={thread.id}>
            <Button
              variant="ghost"
              className="w-full justify-start"
              data-thread-id={thread.id}
              onClick={() => {
                onThread(thread.id);
              }}
            >
              <span className="truncate">{thread.title}</span>
              <span className="ml-auto shrink-0 text-caption text-muted-foreground">
                {statusWords(thread.status) || relativeTimeLabel(thread.updatedAt, nowMs)}
              </span>
            </Button>
          </li>
        ))}
    </ul>
  );
};

const useLivePreview = (threadId: string | null): string | null => {
  const replica = useReplica();
  const [preview, setPreview] = useState<{ threadId: string; text: string } | null>(null);
  useEffect(
    () =>
      replica.onThreadFrame((frame) => {
        const next = frame.threadId === threadId ? previewOf(frame) : null;
        if (next !== null) {
          setPreview(next.text === null ? null : { text: next.text, threadId: next.threadId });
        }
      }),
    [replica, threadId],
  );
  return preview?.threadId === threadId ? preview.text : null;
};

const onRefused = (cause: unknown): void => {
  toast.error(refusalText(cause, "The agent couldn't be reached."));
};

const Conversation = ({
  threadId,
  flushOpen,
}: {
  threadId: string;
  flushOpen: () => Promise<void>;
}) => {
  const { orpc } = useWire();
  const queryClient = useQueryClient();
  const replica = useReplica();
  const queries = useReplicaQueries();
  const stored = useQuery(queries.threadEvents(threadId));
  const rows = stored.data ?? [];
  const thread = (useQuery(queries.threads()).data ?? []).find((row) => row.id === threadId);
  const entries = threadEntries(rows);
  const blocks = threadBlocks(entries);
  const waiting = waitingApprovals(entries);
  const preview = useLivePreview(threadId);
  // the conversation's sets, every page of them: each finished turn's Undo and the whole
  // conversation's need them all
  const setPages = historyPages(orpc, { threadId });
  const sets = useInfiniteQuery(setPages);
  // asked again after every answer, since a refetch that meets a page still being asked starts the
  // pages over and lands as the same data
  const { dataUpdatedAt, fetchNextPage, hasNextPage, isFetching } = sets;
  useEffect(() => {
    if (dataUpdatedAt > 0 && hasNextPage && !isFetching) {
      void fetchNextPage();
    }
  }, [dataUpdatedAt, fetchNextPage, hasNextPage, isFetching]);
  // a turn's change set seals in the push that ends it, so the sets are asked again as each turn
  // ends after the conversation was read, what was read shown meanwhile
  const ended = entries.filter((entry) => entry.event.type === "turn.ended").length;
  const endedRead = useRef<number | null>(null);
  const eventsRead = stored.data !== undefined;
  const setsKey = setPages.queryKey;
  useEffect(() => {
    if (!eventsRead) {
      return;
    }
    if (endedRead.current !== null && endedRead.current !== ended) {
      void queryClient.invalidateQueries({ queryKey: setsKey });
    }
    endedRead.current = ended;
  }, [ended, endedRead, eventsRead, queryClient, setsKey]);
  const respond = useMutation(orpc.library.agent.respond.mutationOptions({ onError: onRefused }));
  const cancel = useMutation(orpc.library.agent.cancel.mutationOptions({ onError: onRefused }));
  const undo = useMutation(
    orpc.library.history.undo.mutationOptions({
      onError: (cause) => {
        toast.error(refusalText(cause, "That couldn't be undone."));
      },
      onSuccess: async () => {
        await queryClient.invalidateQueries({ queryKey: orpc.library.history.key() });
      },
      scope: { id: "history-undo" },
    }),
  );
  const changeSets = changeSetsOf(sets.data?.pages ?? []);
  const undoSets = (ids: readonly string[]): void => {
    void (async () => {
      await flushOpen();
      const kept: string[] = [];
      const refused: string[] = [];
      for (const batch of undoBatches(ids)) {
        try {
          const answer = await undo.mutateAsync({ changeSetIds: batch });
          kept.push(...answer.kept);
          refused.push(...answer.refused);
        } catch {
          // the undo's own onError said why; the batches after it are not sent
          return;
        }
      }
      toast.success(undoSentence({ kept, refused }));
    })();
  };
  const undoTurn = (turn: number): (() => void) | null => {
    const ids = turnUndo(changeSets, turn);
    return ids === null
      ? null
      : () => {
          undoSets(ids);
        };
  };
  // offered once every page is read, so it takes back the whole conversation
  const whole = hasNextPage ? null : conversationUndo(changeSets);
  const working = thread !== undefined && isWorking(thread.status);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3" data-thread={threadId}>
      {blocks.map((block, index) =>
        block.kind === "work" ? (
          <WorkBlock key={block.key} block={block} live={working && index === blocks.length - 1} />
        ) : (
          <EntryRow key={block.key} entry={block.entry} undo={undoTurn} />
        ),
      )}
      {preview === null ? null : <StreamingText text={preview} streaming data-agent-preview />}
      {waiting.map((approval) => {
        const { detail, question } = approvalWords(
          approval,
          (id) => replica.row(id)?.title ?? null,
        );
        return (
          <div key={approval.eventId} data-approval={approval.eventId}>
            <ApprovalCard
              sentLabel="Answered"
              onSubmit={(answers: readonly ApprovalAnswer[]) => {
                const picked = answers[0]?.optionIds[0];
                if (picked === "allow" || picked === "deny") {
                  respond.mutate({ eventId: approval.eventId, result: picked, threadId });
                }
              }}
            >
              <ApprovalQuestion
                questionId={approval.eventId}
                prompt={question}
                detail={detail ?? undefined}
              >
                <ApprovalOption optionId="allow">Approve</ApprovalOption>
                <ApprovalOption optionId="deny">Cancel</ApprovalOption>
              </ApprovalQuestion>
            </ApprovalCard>
          </div>
        );
      })}
      <div className="flex flex-wrap items-center gap-1.5">
        {thread === undefined || statusWords(thread.status) === "" ? null : (
          <span className="text-caption text-muted-foreground">{statusWords(thread.status)}</span>
        )}
        {working ? (
          <Button
            size="compact"
            variant="ghost"
            onClick={() => {
              cancel.mutate({ threadId });
            }}
          >
            Stop
          </Button>
        ) : null}
        {whole === null || working ? null : (
          <Button
            size="compact"
            variant="ghost"
            onClick={() => {
              undoSets(whole);
            }}
          >
            Undo this conversation
          </Button>
        )}
      </div>
    </div>
  );
};

// Tidy my library's request, above the field the person may add to
const TidyChip = ({ onDrop }: { onDrop: () => void }) => (
  <div className="flex items-center gap-1 px-1 pb-1" data-tidy-request>
    <span className="rounded-full bg-muted px-2 py-0.5 text-caption">{TIDY_LABEL}</span>
    <Button variant="ghost" size="compact" onClick={onDrop}>
      Don’t tidy
    </Button>
  </div>
);

const Composer = ({
  threadId,
  onThread,
  viewContext,
  tidying,
  onTidyEnd,
  passage,
  onPassageTaken,
}: {
  threadId: string | null;
  onThread: (threadId: string) => void;
  viewContext: () => AgentViewContext | undefined;
  tidying: boolean;
  onTidyEnd: () => void;
  passage: string | null;
  onPassageTaken: () => void;
}) => {
  const { orpc } = useWire();
  const [text, setText] = useState("");
  const nowMs = useNow();
  const field = useRef<HTMLTextAreaElement>(null);
  const [quoted, setQuoted] = useState<string | null>(null);
  if (passage !== quoted) {
    setQuoted(passage);
    if (passage !== null) {
      setText(quotePassage(text, passage));
    }
  }
  useEffect(() => {
    if (passage !== null) {
      field.current?.focus();
      onPassageTaken();
    }
  }, [onPassageTaken, passage]);
  const send = useMutation(
    orpc.library.agent.send.mutationOptions({
      onError: (cause) => {
        toast.error(
          agentRefusalWords(cause, nowMs) ?? refusalText(cause, "The agent couldn't be reached."),
        );
      },
      onSuccess: (answer) => {
        setText("");
        onTidyEnd();
        onThread(answer.threadId);
      },
    }),
  );
  const submit = (): void => {
    if (send.isPending) {
      return;
    }
    // a Tidy starts a conversation of its own, from Unsorted, whatever the screen shows
    const input = sendInput({ text, threadId, tidying, viewContext: viewContext() });
    if (input !== null) {
      send.mutate(input);
    }
  };
  return (
    <div className="flex shrink-0 flex-col gap-1.5 border-t border-border p-3">
      <InputMessage
        value={text}
        onValueChange={setText}
        onSend={submit}
        placeholder={composerPlaceholder(tidying, threadId)}
        sendsEmpty={tidying}
        topSlot={tidying ? <TidyChip onDrop={onTidyEnd} /> : undefined}
        sendLabel="Send"
        minRows={2}
        maxRows={8}
        disabled={send.isPending}
        textareaRef={field}
        textareaProps={{ "aria-label": "Message the agent" }}
      />
    </div>
  );
};

export const AgentPanel = ({
  threadId,
  onThread,
  viewContext,
  flushOpen,
  tidying,
  onTidyEnd,
  passage,
  onPassageTaken,
}: AgentPanelProps) => (
  <div className="flex h-full min-h-0 flex-col" data-agent-panel>
    <div className="flex h-10 shrink-0 items-center gap-1 px-2">
      {threadId === null ? (
        <span className="px-1 text-body font-medium">Conversations</span>
      ) : (
        <Button
          variant="ghost"
          size="icon-compact"
          aria-label="All conversations"
          onClick={() => {
            onThread(null);
          }}
        >
          <ArrowLeftIcon />
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon-compact"
        className="ml-auto"
        aria-label="New conversation"
        onClick={() => {
          onThread(null);
        }}
      >
        <PlusIcon />
      </Button>
    </div>
    {threadId === null ? (
      <ThreadList onThread={onThread} />
    ) : (
      <Conversation threadId={threadId} flushOpen={flushOpen} />
    )}
    <Composer
      threadId={threadId}
      onThread={onThread}
      viewContext={viewContext}
      tidying={tidying}
      onTidyEnd={onTidyEnd}
      passage={passage}
      onPassageTaken={onPassageTaken}
    />
  </div>
);
