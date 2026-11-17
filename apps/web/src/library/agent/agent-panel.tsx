// CLAUDE.md § The agent panel is the account's threads. The built-in agent's conversations, the
// same on every device: the threads and their stored events come from the cell, read again as an
// answer of what moved names them, and a send, an answer to an approval, a stop and an undo go to
// the cell, so each waits for a connection. A message carries the screen it was sent from (the open item, or the grid's scope and
// selection).

import { composerPlaceholder, sendInput } from "@repo/client/agent-send";
import type { AgentViewContext } from "@repo/client/agent-send";
import {
  answerWords,
  approvalWords,
  callRefusalWords,
  conversationOf,
  EMPTY_WORDS,
  endingWords,
  isUnderWay,
  isWorking,
  readsOnly,
  sendRefusalWords,
  statusWords,
  toolWords,
  workWords,
} from "@repo/client/thread-entries";
import type { ThreadBlock, ThreadEntry, WaitingApproval } from "@repo/client/thread-entries";
import { shownTitle } from "@repo/contract/items/item-name";
import { ApprovalCard } from "@repo/ui/ai/approval-card";
import { StreamingText } from "@repo/ui/ai/streaming-text";
import { Thinking, ThinkingReasoning } from "@repo/ui/ai/thinking";
import { ToolChip, ToolChipList } from "@repo/ui/ai/tool-chips";
import { Button } from "@repo/ui/components/button";
import { InputMessage } from "@repo/ui/components/input-message";
import { toast } from "@repo/ui/components/sonner";
import { plural } from "@repo/ui/lib/plural";
import { useIsMutating, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PlusIcon } from "lucide-react";
import { useEffect, useRef } from "react";
import { useStore } from "zustand";

import { useLibraryQueries, usePageLibrary } from "../cloud/library-context";
import { refusalText } from "@repo/contract/rpc/refusal-text";
import { relativeTimeLabel, useNow } from "../relative-time";
import { TIDY_LABEL, TIDY_PLACEHOLDER, TIDY_VIEW_CONTEXT, tidyMessage } from "./tidy-library";
import { announceUndo } from "./undo-answer";
import { UNDO_SCOPE, undoToEnd, useUndoWaits } from "./undo-queue";

export interface AgentPanelProps {
  // the screen the next message leaves from, read as it is sent
  readonly viewContext: () => AgentViewContext | undefined;
  // writes what the open item holds unsaved, so an undo meets the item as the person sees it
  readonly flushOpen: () => Promise<void>;
}

const EntryRow = ({
  entry,
  undo,
  undoWaits,
}: {
  entry: ThreadEntry;
  undo: (turn: number) => (() => void) | null;
  undoWaits: boolean;
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
    // a run of work and an asked approval draw as blocks of their own (`conversationOf`)
    case "agent.progress":
    case "agent.tool_use":
    case "agent.tool_result":
    case "approval.asked": {
      return null;
    }
    case "approval.answered": {
      return <p className="m-0 text-caption text-muted-foreground">{answerWords(event)}</p>;
    }
    case "turn.ended": {
      const words = endingWords(event.reason);
      const run = undo(event.turn);
      return (
        <div className="flex items-center gap-2" data-turn-ended={event.turn}>
          {words === "" ? null : <p className="m-0 text-caption text-muted-foreground">{words}</p>}
          {run === null ? null : (
            <Button size="compact" variant="ghost" disabled={undoWaits} onClick={run}>
              Undo this turn
            </Button>
          )}
        </div>
      );
    }
    // no default
  }
};

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
    doneLabel={workWords(block.uses.length)}
    working={live}
    data-agent-work
  >
    {block.notes.map((note) => (
      <ThinkingReasoning key={note.eventId}>{note.text}</ThinkingReasoning>
    ))}
    {block.uses.length === 0 ? null : (
      <ToolChipList summary={plural(block.uses.length, "library call")}>
        {block.uses.map((use) => (
          <ToolChip
            key={use.toolUseId}
            icon={readsOnly(use.name) ? "read" : "write"}
            label={toolWords(use.name)}
            use={use}
          />
        ))}
      </ToolChipList>
    )}
  </Thinking>
);

const ThreadList = ({ onThread }: { onThread: (threadId: string | null) => void }) => {
  const threads = useQuery(useLibraryQueries().threads()).data?.threads ?? [];
  const nowMs = useNow();
  if (threads.length === 0) {
    return <p className="m-0 px-3 py-2 text-body text-muted-foreground">{EMPTY_WORDS}</p>;
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

const onRefused = (cause: unknown): void => {
  toast.error(callRefusalWords(cause));
};

// read as the send fails, since the allowance's words name when it fills again from now
const onSendRefused = (cause: unknown): void => {
  toast.error(sendRefusalWords(cause, Date.now()));
};

const APPROVAL_OPTIONS = [
  { label: "Approve", value: "allow" },
  { label: "Cancel", value: "deny" },
] as const;

// one call waiting on the person, and the answer to it: its options are held from the press until
// the thread drops the card, and handed back when the answer is refused
const Approval = ({
  approval,
  threadId,
  titleOf,
}: {
  approval: WaitingApproval;
  threadId: string;
  titleOf: (id: string) => string | null;
}) => {
  const { orpc } = usePageLibrary().wire;
  const respond = useMutation(orpc.library.agent.respond.mutationOptions({ onError: onRefused }));
  const { detail, question } = approvalWords(approval, titleOf);
  return (
    <ApprovalCard
      data-approval={approval.eventId}
      prompt={question}
      detail={detail}
      options={APPROVAL_OPTIONS}
      picked={respond.isPending || respond.isSuccess ? respond.variables.result : null}
      onPick={(result) => {
        respond.mutate({ eventId: approval.eventId, result, threadId });
      }}
    />
  );
};

const Conversation = ({
  threadId,
  flushOpen,
}: {
  threadId: string;
  flushOpen: () => Promise<void>;
}) => {
  const { client, orpc } = usePageLibrary().wire;
  const queryClient = useQueryClient();
  const queries = useLibraryQueries();
  const rows = useQuery(queries.threadEvents(threadId)).data?.events ?? [];
  const thread = useQuery(queries.threads()).data?.threads.find((row) => row.id === threadId);
  const titles = useQuery(queries.titles()).data?.targets ?? [];
  const { blocks, waiting } = conversationOf(rows);
  const undoable = useQuery(queries.undoable(threadId)).data?.turns ?? [];
  const cancel = useMutation(orpc.library.agent.cancel.mutationOptions({ onError: onRefused }));
  // a press names its conversation, so one that waits offline keeps to it whichever is open when
  // it goes
  const undo = useMutation(
    orpc.library.agent.undo.mutationOptions({
      mutationFn: async (press) => await undoToEnd(client, press),
      onError: (cause) => {
        toast.error(refusalText(cause, "That couldn't be undone."));
      },
      onMutate: flushOpen,
      // awaited, so the queue holds every Undo down until the turns left to undo are read again:
      // what moved may be asked after the answer, and a press between the two would ask for what
      // just went back
      onSettled: async () => {
        await queryClient.invalidateQueries({ queryKey: orpc.library.agent.undoable.key() });
      },
      onSuccess: (answer) => {
        announceUndo(answer, (id) =>
          shownTitle(titles.find((target) => target.id === id)?.title ?? ""),
        );
      },
      scope: UNDO_SCOPE,
    }),
  );
  const undoWaits = useUndoWaits();
  const undoTurn = (turn: number): (() => void) | null =>
    undoable.includes(turn)
      ? () => {
          undo.mutate({ threadId, turn });
        }
      : null;
  const working = thread !== undefined && isWorking(thread.status);
  const underWay = thread !== undefined && isUnderWay(thread.status);
  // a reversed column scrolls from its end, so the browser keeps the conversation on the reply as
  // it grows and lets go once the person scrolls up; the auto margin keeps a short one at the top
  return (
    <div className="flex min-h-0 flex-1 flex-col-reverse overflow-y-auto" data-thread={threadId}>
      <div className="mb-auto flex flex-col gap-2 p-3">
        {blocks.map((block, index) =>
          block.kind === "work" ? (
            <WorkBlock
              key={block.key}
              block={block}
              live={working && index === blocks.length - 1}
            />
          ) : (
            <EntryRow key={block.key} entry={block.entry} undo={undoTurn} undoWaits={undoWaits} />
          ),
        )}
        {waiting.map((approval) => (
          <Approval
            key={approval.eventId}
            approval={approval}
            threadId={threadId}
            titleOf={(id) => titles.find((target) => target.id === id)?.title ?? null}
          />
        ))}
        <div className="flex flex-wrap items-center gap-1.5">
          {thread === undefined || statusWords(thread.status) === "" ? null : (
            <span className="text-caption text-muted-foreground">{statusWords(thread.status)}</span>
          )}
          {underWay ? (
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
          {undoable.length === 0 || underWay ? null : (
            <Button
              size="compact"
              variant="ghost"
              disabled={undoWaits}
              onClick={() => {
                undo.mutate({ threadId });
              }}
            >
              Undo this conversation
            </Button>
          )}
        </div>
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

const Composer = ({ viewContext }: { viewContext: () => AgentViewContext | undefined }) => {
  const {
    wire: { orpc },
    workspace,
  } = usePageLibrary();
  const { quoted, target, text } = useStore(workspace.store, (state) => state.composer);
  const field = useRef<HTMLTextAreaElement>(null);
  const tidying = target.kind === "tidying";
  const threadId = target.kind === "asking" ? target.threadId : null;
  // a passage waiting on the person's question hands the field the keyboard, as it is quoted and
  // as the composer comes up holding it
  useEffect(() => {
    if (quoted > 0) {
      field.current?.focus();
    }
  }, [quoted]);
  const send = useMutation(
    orpc.library.agent.send.mutationOptions({
      onError: onSendRefused,
      onSuccess: (answer) => {
        workspace.compose({ kind: "sent", threadId: answer.threadId });
      },
    }),
  );
  // read off the cache, since the words outlive this composer and a send may too
  const sending = useIsMutating({ mutationKey: orpc.library.agent.send.mutationKey() }) > 0;
  const submit = (): void => {
    if (sending) {
      return;
    }
    // a Tidy starts a conversation of its own, from Unsorted, whatever the screen shows
    const input = tidying
      ? { text: tidyMessage(text), viewContext: TIDY_VIEW_CONTEXT }
      : sendInput({ text, threadId, viewContext: viewContext() });
    if (input !== null) {
      send.mutate(input);
    }
  };
  return (
    <div className="flex shrink-0 flex-col gap-1.5 border-t border-border p-3">
      <InputMessage
        value={text}
        onValueChange={(typed) => {
          workspace.compose({ kind: "typed", text: typed });
        }}
        onSend={submit}
        placeholder={tidying ? TIDY_PLACEHOLDER : composerPlaceholder(threadId)}
        sendsEmpty={tidying}
        topSlot={
          tidying ? (
            <TidyChip
              onDrop={() => {
                workspace.compose({ kind: "tidyEnded" });
              }}
            />
          ) : undefined
        }
        sendLabel="Send"
        minRows={2}
        maxRows={8}
        disabled={sending}
        textareaRef={field}
        textareaProps={{ "aria-label": "Message the agent" }}
      />
    </div>
  );
};

export const AgentPanel = ({ viewContext, flushOpen }: AgentPanelProps) => {
  const { workspace } = usePageLibrary();
  // the conversation shown: the one the composer sends to
  const threadId = useStore(workspace.store, ({ composer: { target } }) =>
    target.kind === "asking" ? target.threadId : null,
  );
  const onThread = (next: string | null): void => {
    workspace.compose({ kind: "chose", threadId: next });
  };
  return (
    <div className="flex h-full min-h-0 flex-col" data-agent-panel>
      <div className="flex h-10 shrink-0 items-center gap-1 px-2">
        {threadId === null && <span className="px-1 text-body font-medium">Conversations</span>}
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
      <Composer viewContext={viewContext} />
    </div>
  );
};
