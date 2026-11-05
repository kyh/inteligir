// CLAUDE.md § THE AGENT PANEL IS THE ACCOUNT'S THREADS. The built-in agent's conversations, the
// same on every device: the threads and their stored events come from the replica (so a past one
// reads offline), the reply being written arrives on the socket as previews, and a send, an
// answer to an approval, a stop and an undo go to the cell, so each waits for a connection. A
// message carries the screen it was sent from (the open item, or the grid's scope and selection).

import { agentPreviewSchema } from "@repo/contract/cloud/library/agent-events";
import type { agentViewContextSchema } from "@repo/contract/cloud/library/library-wire";
import { ApprovalCard, ApprovalOption, ApprovalQuestion } from "@repo/ui/ai/approval-card";
import type { ApprovalAnswer } from "@repo/ui/ai/approval-card";
import { StreamingText } from "@repo/ui/ai/streaming-text";
import { Thinking, ThinkingReasoning } from "@repo/ui/ai/thinking";
import { ToolChip, ToolChipDetail, ToolChipList } from "@repo/ui/ai/tool-chips";
import { Button } from "@repo/ui/components/button";
import { InputMessage } from "@repo/ui/components/input-message";
import { toast } from "@repo/ui/components/sonner";
import { plural } from "@repo/ui/lib/plural";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeftIcon, PlusIcon } from "lucide-react";
import { useEffect, useState } from "react";
import type { z } from "zod";

import { useReplica, useReplicaQueries, useWire } from "../cloud/library-context";
import { refusalText } from "../cloud/needs-connection";
import { relativeTimeLabel, useNow } from "../relative-time";
import {
  agentRefusalWords,
  approvalQuestion,
  endingWords,
  readsOnly,
  threadBlocks,
  threadEntries,
  toolWords,
  waitingApprovals,
} from "./thread-entries";
import type { ThreadBlock, ThreadEntry, ToolUse } from "./thread-entries";
import { conversationUndo, turnUndo } from "./thread-undo";

export type AgentViewContext = z.infer<typeof agentViewContextSchema>;

export interface AgentPanelProps {
  readonly threadId: string | null;
  readonly onThread: (threadId: string | null) => void;
  // the screen the next message leaves from, read as it is sent
  readonly viewContext: () => AgentViewContext | undefined;
  // writes what the open item holds unsaved, so an undo meets the item as the person sees it
  readonly flushOpen: () => Promise<void>;
}

const STATUS_WORDS = {
  awaiting_approval: "Waiting for you",
  idle: "",
  queued: "Waiting its turn…",
  running: "Working…",
} as const;

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
                {STATUS_WORDS[thread.status] || relativeTimeLabel(thread.updatedAt, nowMs)}
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
        if (frame.threadId !== threadId) {
          return;
        }
        if (!frame.preview) {
          setPreview(null);
          return;
        }
        const parsed = agentPreviewSchema.safeParse(frame.event);
        if (parsed.success) {
          setPreview({ text: parsed.data.text, threadId: frame.threadId });
        }
      }),
    [replica, threadId],
  );
  return preview !== null && preview.threadId === threadId ? preview.text : null;
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
  const { client, orpc } = useWire();
  const queryClient = useQueryClient();
  const queries = useReplicaQueries();
  const rows = useQuery(queries.threadEvents(threadId)).data ?? [];
  const thread = (useQuery(queries.threads()).data ?? []).find((row) => row.id === threadId);
  const entries = threadEntries(rows);
  const blocks = threadBlocks(entries);
  const waiting = waitingApprovals(entries);
  const preview = useLivePreview(threadId);
  // a turn's change set seals in the push that ends it, so the count of ended turns is part of the
  // list's key, and it is asked again as each turn ends, the last answer shown meanwhile
  const ended = entries.filter((entry) => entry.event.type === "turn.ended").length;
  const sets = useQuery({
    placeholderData: keepPreviousData,
    queryFn: async ({ signal }) => await client.library.history.list({ threadId }, { signal }),
    queryKey: [...orpc.library.history.list.queryKey({ input: { threadId } }), ended],
  });
  const respond = useMutation(orpc.library.agent.respond.mutationOptions({ onError: onRefused }));
  const cancel = useMutation(orpc.library.agent.cancel.mutationOptions({ onError: onRefused }));
  const undo = useMutation(
    orpc.library.history.undo.mutationOptions({
      onError: (cause) => {
        toast.error(refusalText(cause, "That couldn't be undone."));
      },
      onSuccess: async () => {
        toast.success("Undone.");
        await queryClient.invalidateQueries({ queryKey: orpc.library.history.key() });
      },
      scope: { id: "history-undo" },
    }),
  );
  const changeSets = sets.data?.changeSets ?? [];
  const undoSets = (ids: string[]): void => {
    void (async () => {
      await flushOpen();
      undo.mutate({ changeSetIds: ids });
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
  const whole = conversationUndo(changeSets);
  const working = thread?.status === "running" || thread?.status === "queued";
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
      {waiting.map((approval) => (
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
              prompt={approvalQuestion(approval)}
              kind="radio"
            >
              <ApprovalOption optionId="allow">Approve</ApprovalOption>
              <ApprovalOption optionId="deny">Cancel</ApprovalOption>
            </ApprovalQuestion>
          </ApprovalCard>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-1.5">
        {thread === undefined || STATUS_WORDS[thread.status] === "" ? null : (
          <span className="text-caption text-muted-foreground">{STATUS_WORDS[thread.status]}</span>
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

const Composer = ({
  threadId,
  onThread,
  viewContext,
}: {
  threadId: string | null;
  onThread: (threadId: string) => void;
  viewContext: () => AgentViewContext | undefined;
}) => {
  const { orpc } = useWire();
  const [text, setText] = useState("");
  const nowMs = useNow();
  const send = useMutation(
    orpc.library.agent.send.mutationOptions({
      onError: (cause) => {
        toast.error(
          agentRefusalWords(cause, nowMs) ?? refusalText(cause, "The agent couldn't be reached."),
        );
      },
      onSuccess: (answer) => {
        setText("");
        onThread(answer.threadId);
      },
    }),
  );
  const submit = (): void => {
    const message = text.trim();
    if (message === "" || send.isPending) {
      return;
    }
    const context = viewContext();
    const input: Parameters<typeof send.mutate>[0] = { text: message };
    if (threadId !== null) {
      input.threadId = threadId;
    }
    if (context !== undefined) {
      input.viewContext = context;
    }
    send.mutate(input);
  };
  return (
    <div className="flex shrink-0 flex-col gap-1.5 border-t border-border p-3">
      <InputMessage
        value={text}
        onValueChange={setText}
        onSend={submit}
        placeholder={threadId === null ? "Ask the agent…" : "Reply…"}
        sendLabel="Send"
        minRows={2}
        maxRows={8}
        disabled={send.isPending}
        textareaProps={{ "aria-label": "Message the agent" }}
      />
    </div>
  );
};

export const AgentPanel = ({ threadId, onThread, viewContext, flushOpen }: AgentPanelProps) => (
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
    <Composer threadId={threadId} onThread={onThread} viewContext={viewContext} />
  </div>
);
