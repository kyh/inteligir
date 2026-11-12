// CLAUDE.md § The agent panel is the account's threads. The built-in agent's conversations, the
// same on every device: the threads and their stored events come from the cell, read again as the
// account's socket says they moved, the reply being written arrives on the socket as previews,
// and a send, an answer to an approval, a stop and an undo go to the cell, so each waits for a
// connection. A message carries the screen it was sent from (the open item, or the grid's scope and
// selection).

import { composerPlaceholder, sendInput } from "@repo/agent-panel/agent-send";
import type { AgentViewContext } from "@repo/agent-panel/agent-send";
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
} from "@repo/agent-panel/thread-entries";
import type { ThreadBlock, ThreadEntry, ToolUse } from "@repo/agent-panel/thread-entries";
import { shownTitle } from "@repo/contract/items/item-name";
import { ApprovalCard, ApprovalOption, ApprovalQuestion } from "@repo/ui/ai/approval-card";
import type { ApprovalAnswer } from "@repo/ui/ai/approval-card";
import { StreamingText } from "@repo/ui/ai/streaming-text";
import { Thinking, ThinkingReasoning } from "@repo/ui/ai/thinking";
import { ToolChip, ToolChipDetail, ToolChipList } from "@repo/ui/ai/tool-chips";
import { Button } from "@repo/ui/components/button";
import { InputMessage } from "@repo/ui/components/input-message";
import { toast } from "@repo/ui/components/sonner";
import { plural } from "@repo/ui/lib/plural";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeftIcon, PlusIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { everyChangeSet, UNDO_SCOPE, useUndoWaits } from "../cloud/change-set-pages";
import { useLibraryQueries, usePageLibrary } from "../cloud/library-context";
import { retryUnlessRefused } from "../cloud/v1";
import { refusalText } from "@repo/contract/refusal-text";
import { relativeTimeLabel, useNow } from "../relative-time";
import type { ComposerEvent, ComposerState } from "./agent-composer";
import { quotePassage } from "./quote-passage";
import { chunksOf } from "../library/bulk-actions";
import { conversationUndo, turnUndo } from "./thread-undo";
import { TIDY_LABEL, TIDY_PLACEHOLDER, TIDY_VIEW_CONTEXT, tidyMessage } from "./tidy-library";
import { announceUndo } from "./undo-answer";

export interface AgentPanelProps {
  // the conversation shown and what the composer holds, which the workspace keeps
  readonly composer: ComposerState;
  readonly dispatch: (event: ComposerEvent) => void;
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

const ToolRow = ({ use }: { use: ToolUse }) => (
  <ToolChip
    icon={readsOnly(use.name) ? "read" : "write"}
    label={toolWords(use.name)}
    chip={use.kind === "running" ? "…" : ""}
    failed={use.kind === "failed"}
  >
    {use.kind === "failed" ? <ToolChipDetail>{use.message}</ToolChipDetail> : null}
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
          <ToolRow key={use.toolUseId} use={use} />
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

const useLivePreview = (threadId: string | null): string | null => {
  const { socket } = usePageLibrary();
  const [preview, setPreview] = useState<{ threadId: string; text: string } | null>(null);
  useEffect(
    () =>
      socket.onPreview((heard) => {
        if (heard.text !== null) {
          if (heard.threadId === threadId) {
            setPreview({ text: heard.text, threadId: heard.threadId });
          }
        } else if (heard.threadId === null || heard.threadId === threadId) {
          setPreview(null);
        }
      }),
    [socket, threadId],
  );
  return preview?.threadId === threadId ? preview.text : null;
};

const onRefused = (cause: unknown): void => {
  toast.error(callRefusalWords(cause));
};

// read as the send fails, since the allowance's words name when it fills again from now
const onSendRefused = (cause: unknown): void => {
  toast.error(sendRefusalWords(cause, Date.now()));
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
  const preview = useLivePreview(threadId);
  const changeSets = useQuery(queries.changeSets(threadId)).data?.changeSets;
  const respond = useMutation(orpc.library.agent.respond.mutationOptions({ onError: onRefused }));
  const cancel = useMutation(orpc.library.agent.cancel.mutationOptions({ onError: onRefused }));
  const undo = useMutation(
    orpc.library.history.undo.mutationOptions({
      onError: (cause) => {
        toast.error(refusalText(cause, "That couldn't be undone."));
      },
      onMutate: flushOpen,
      // refused too: an open list hears nothing of what another device took back, so a refusal can
      // be the first it learns of it
      onSettled: async () => {
        await queryClient.invalidateQueries({ queryKey: orpc.library.history.key() });
      },
      scope: UNDO_SCOPE,
    }),
  );
  const undoWaits = useUndoWaits();
  const undoSets = (ids: readonly string[]): void => {
    void (async () => {
      const kept: string[] = [];
      const lostText: string[] = [];
      const refused: string[] = [];
      const reverted: string[] = [];
      for (const batch of chunksOf(ids)) {
        try {
          const answer = await undo.mutateAsync({ changeSetIds: batch });
          kept.push(...answer.kept);
          lostText.push(...answer.lostText.filter((id) => !lostText.includes(id)));
          refused.push(...answer.refused);
          reverted.push(...answer.reverted);
        } catch {
          // the undo's own onError said why; the batches after it are not sent
          return;
        }
      }
      announceUndo({ kept, lostText, refused, reverted }, (id) =>
        shownTitle(titles.find((target) => target.id === id)?.title ?? ""),
      );
    })();
  };
  const undoTurn = (turn: number): (() => void) | null => {
    const ids = changeSets === undefined ? null : turnUndo(changeSets, turn);
    return ids === null
      ? null
      : () => {
          undoSets(ids);
        };
  };
  const whole = changeSets === undefined ? null : conversationUndo(changeSets);
  // read again at the press: a turn's set seals as the turn ends and the list on screen follows it,
  // so that list can be a turn short of the conversation, or hold what another device took back. A
  // mutation though it writes nothing, so the press waits offline under the layout's notice and in
  // the undos' queue. Keyed by the conversation, since one that waits can outlast this component:
  // the key keeps it to the conversation it was pressed in
  const undoConversation = useMutation({
    mutationFn: async () => await everyChangeSet(client, { threadId }),
    mutationKey: ["undo-conversation", threadId],
    onError: (cause) => {
      toast.error(refusalText(cause, "That couldn't be undone."));
    },
    onSuccess: async (read) => {
      const ids = conversationUndo(read);
      if (ids !== null) {
        undoSets(ids);
        return;
      }
      toast.info("There's nothing left to undo in this conversation.");
      await queryClient.invalidateQueries({ queryKey: orpc.library.history.key() });
    },
    retry: retryUnlessRefused,
    scope: UNDO_SCOPE,
  });
  const working = thread !== undefined && isWorking(thread.status);
  const underWay = thread !== undefined && isUnderWay(thread.status);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3" data-thread={threadId}>
      {blocks.map((block, index) =>
        block.kind === "work" ? (
          <WorkBlock key={block.key} block={block} live={working && index === blocks.length - 1} />
        ) : (
          <EntryRow key={block.key} entry={block.entry} undo={undoTurn} undoWaits={undoWaits} />
        ),
      )}
      {preview === null ? null : <StreamingText text={preview} streaming data-agent-preview />}
      {waiting.map((approval) => {
        const { detail, question } = approvalWords(
          approval,
          (id) => titles.find((target) => target.id === id)?.title ?? null,
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
        {whole === null || underWay ? null : (
          <Button
            size="compact"
            variant="ghost"
            disabled={undoWaits}
            onClick={() => {
              undoConversation.mutate();
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
  composer,
  dispatch,
  viewContext,
}: {
  composer: ComposerState;
  dispatch: (event: ComposerEvent) => void;
  viewContext: () => AgentViewContext | undefined;
}) => {
  const { orpc } = usePageLibrary().wire;
  const [text, setText] = useState("");
  const field = useRef<HTMLTextAreaElement>(null);
  const tidying = composer.kind === "tidying";
  const threadId = composer.kind === "asking" ? composer.threadId : null;
  const passage = composer.kind === "asking" ? composer.passage : null;
  // quoted as it renders, until the composer lets the passage go: quoting it twice changes nothing
  const quoted = passage === null ? text : quotePassage(text, passage);
  if (quoted !== text) {
    setText(quoted);
  }
  useEffect(() => {
    if (passage !== null) {
      field.current?.focus();
      dispatch({ kind: "quoted" });
    }
  }, [dispatch, passage]);
  const send = useMutation(
    orpc.library.agent.send.mutationOptions({
      onError: onSendRefused,
      // the conversation it went to, which lets a Tidy go
      onSuccess: (answer) => {
        setText("");
        dispatch({ kind: "chose", threadId: answer.threadId });
      },
    }),
  );
  const submit = (): void => {
    if (send.isPending) {
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
        onValueChange={setText}
        onSend={submit}
        placeholder={tidying ? TIDY_PLACEHOLDER : composerPlaceholder(threadId)}
        sendsEmpty={tidying}
        topSlot={
          tidying ? (
            <TidyChip
              onDrop={() => {
                dispatch({ kind: "tidyEnded" });
              }}
            />
          ) : undefined
        }
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

export const AgentPanel = ({ composer, dispatch, viewContext, flushOpen }: AgentPanelProps) => {
  const threadId = composer.kind === "asking" ? composer.threadId : null;
  const onThread = (next: string | null): void => {
    dispatch({ kind: "chose", threadId: next });
  };
  return (
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
      <Composer composer={composer} dispatch={dispatch} viewContext={viewContext} />
    </div>
  );
};
