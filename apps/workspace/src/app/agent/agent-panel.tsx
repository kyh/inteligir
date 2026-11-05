// CLAUDE.md § THE AGENT PANEL IS THE ACCOUNT'S THREADS. The built-in agent's conversations, the
// same on every device: the threads and their stored events come from the replica (so a past one
// reads offline), the reply being written arrives on the socket as previews, and a send, an
// answer to an approval, a stop and an undo go to the cell, so each waits for a connection. A
// message carries the screen it was sent from (the open item, or the grid's scope and selection).

import { agentPreviewSchema } from "@repo/contract/cloud/library/agent-events";
import type { agentViewContextSchema } from "@repo/contract/cloud/library/library-wire";
import { Button } from "@repo/ui/components/button";
import { toast } from "@repo/ui/components/sonner";
import { Textarea } from "@repo/ui/components/textarea";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeftIcon, PlusIcon } from "lucide-react";
import { useEffect, useState } from "react";
import type { z } from "zod";

import { useReplica, useReplicaQueries, useWire } from "../cloud/library-context";
import { NEEDS_CONNECTION, refusalText } from "../cloud/needs-connection";
import { relativeTimeLabel, useNow } from "../relative-time";
import {
  agentRefusalWords,
  approvalQuestion,
  endingWords,
  threadEntries,
  toolWords,
  waitingApprovals,
} from "./thread-entries";
import type { ThreadEntry } from "./thread-entries";
import { conversationUndo, turnUndo } from "./thread-undo";

export type AgentViewContext = z.infer<typeof agentViewContextSchema>;

export interface AgentPanelProps {
  readonly threadId: string | null;
  readonly onThread: (threadId: string | null) => void;
  // the screen the next message leaves from, read as it is sent
  readonly viewContext: () => AgentViewContext | undefined;
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
      return <p className="m-0 text-body whitespace-pre-wrap select-text">{event.text}</p>;
    }
    case "agent.progress": {
      return <p className="m-0 text-caption text-muted-foreground italic">{event.text}</p>;
    }
    case "agent.tool_use": {
      return <p className="m-0 text-caption text-muted-foreground">{toolWords(event.name)}</p>;
    }
    case "agent.tool_result": {
      return event.isError ? (
        <p className="m-0 text-caption text-destructive select-text">{event.summary}</p>
      ) : null;
    }
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

const Conversation = ({ threadId }: { threadId: string }) => {
  const { orpc } = useWire();
  const queryClient = useQueryClient();
  const queries = useReplicaQueries();
  const rows = useQuery(queries.threadEvents(threadId)).data ?? [];
  const thread = (useQuery(queries.threads()).data ?? []).find((row) => row.id === threadId);
  const entries = threadEntries(rows);
  const waiting = waitingApprovals(entries);
  const preview = useLivePreview(threadId);
  const sets = useQuery(orpc.library.history.list.queryOptions({ input: { threadId } }));
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
  const undoTurn = (turn: number): (() => void) | null => {
    const ids = turnUndo(changeSets, turn);
    return ids === null
      ? null
      : () => {
          undo.mutate({ changeSetIds: ids });
        };
  };
  const whole = conversationUndo(changeSets);
  const working = thread?.status === "running" || thread?.status === "queued";
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3" data-thread={threadId}>
      {entries.map((entry) => (
        <EntryRow key={entry.eventId} entry={entry} undo={undoTurn} />
      ))}
      {preview === null ? null : (
        <p className="m-0 text-body whitespace-pre-wrap text-ink-2" data-agent-preview>
          {preview}
        </p>
      )}
      {waiting.map((approval) => (
        <div
          key={approval.eventId}
          className="flex flex-col gap-2 rounded-md border border-border p-2.5"
          data-approval={approval.eventId}
        >
          <p className="m-0 text-body">{approvalQuestion(approval)}</p>
          <div className="flex gap-1.5">
            <Button
              size="compact"
              disabled={respond.isPending}
              onClick={() => {
                respond.mutate({ eventId: approval.eventId, result: "allow", threadId });
              }}
            >
              Approve
            </Button>
            <Button
              size="compact"
              variant="secondary"
              disabled={respond.isPending}
              onClick={() => {
                respond.mutate({ eventId: approval.eventId, result: "deny", threadId });
              }}
            >
              Cancel
            </Button>
          </div>
          {respond.isPaused ? (
            <p className="m-0 text-caption text-muted-foreground">{NEEDS_CONNECTION}</p>
          ) : null}
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
              undo.mutate({ changeSetIds: whole });
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
    <form
      className="flex shrink-0 flex-col gap-1.5 border-t border-border p-3"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <Textarea
        aria-label="Message the agent"
        placeholder={threadId === null ? "Ask the agent…" : "Reply…"}
        rows={3}
        className="resize-none"
        value={text}
        onChange={(event) => {
          setText(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            submit();
          }
        }}
      />
      <div className="flex items-center gap-2">
        {send.isPaused ? (
          <span className="text-caption text-muted-foreground">{NEEDS_CONNECTION}</span>
        ) : null}
        <Button type="submit" size="compact" className="ml-auto" disabled={text.trim() === ""}>
          Send
        </Button>
      </div>
    </form>
  );
};

export const AgentPanel = ({ threadId, onThread, viewContext }: AgentPanelProps) => (
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
    {threadId === null ? <ThreadList onThread={onThread} /> : <Conversation threadId={threadId} />}
    <Composer threadId={threadId} onThread={onThread} viewContext={viewContext} />
  </div>
);
