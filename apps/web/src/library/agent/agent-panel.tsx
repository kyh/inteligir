import { composerPlaceholder, sendInput } from "@repo/client/agent-send";
import type { AgentViewContext } from "@repo/client/agent-send";
import {
  callRefusalWords,
  conversationOf,
  EMPTY_WORDS,
  endingWords,
  sendRefusalWords,
  statusWords,
} from "@repo/client/thread-entries";
import type { ThreadBlock, ThreadEntry } from "@repo/client/thread-entries";
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
  readonly viewContext: () => AgentViewContext | undefined;
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
      return <StreamingText className="select-text" text={event.text} />;
    }

    case "agent.progress":
    case "agent.tool_use":
    case "agent.tool_result": {
      return null;
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

    default: {
      throw new Error(`unexpected ${String(event satisfies never)}`);
    }
  }
};

const WorkBlock = ({
  block,
  live,
}: {
  block: Extract<ThreadBlock, { kind: "work" }>;
  live: boolean;
}) => (
  <Thinking
    label={block.notes.at(-1)?.text ?? "Working"}
    doneLabel={block.doneWords}
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
            icon={use.reads ? "read" : "write"}
            label={use.label}
            use={use}
          />
        ))}
      </ToolChipList>
    )}
  </Thinking>
);

const Block = ({
  block,
  live,
  undo,
  undoWaits,
}: {
  block: ThreadBlock;
  live: boolean;
  undo: (turn: number) => (() => void) | null;
  undoWaits: boolean;
}) => {
  switch (block.kind) {
    case "work": {
      return <WorkBlock block={block} live={live} />;
    }

    case "draft": {
      return <StreamingText className="select-text" text={block.text} streaming data-agent-draft />;
    }

    case "entry": {
      return <EntryRow entry={block.entry} undo={undo} undoWaits={undoWaits} />;
    }

    default: {
      throw new Error(`unexpected ${String(block satisfies never)}`);
    }
  }
};

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

const onRefused = (cause: unknown) => {
  toast.error(callRefusalWords(cause));
};

const onSendRefused = (cause: unknown) => {
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
  const followed = useQuery(queries.threadEvents(threadId)).data;
  const { blocks, underWay } = conversationOf(followed?.rows ?? [], followed?.draft ?? "");
  const undoable = useQuery(queries.undoable(threadId)).data?.turns ?? [];
  const cancel = useMutation(orpc.library.agent.cancel.mutationOptions({ onError: onRefused }));

  const undo = useMutation(
    orpc.library.agent.undo.mutationOptions({
      mutationFn: async (press) => await undoToEnd(client, press),
      onError: (cause) => {
        toast.error(refusalText(cause, "That couldn't be undone."));
      },
      onMutate: flushOpen,
      onSettled: async () => {
        await queryClient.invalidateQueries({ queryKey: orpc.library.agent.undoable.key() });
      },
      onSuccess: announceUndo,
      scope: UNDO_SCOPE,
    }),
  );

  const undoWaits = useUndoWaits();

  const undoTurn = (turn: number) =>
    (undoable.includes(turn)
      ? () => {
          undo.mutate({ threadId, turn });
        }
      : null) satisfies (() => void) | null;

  const status = underWay ? "running" : "idle";

  return (
    <div className="flex min-h-0 flex-1 flex-col-reverse overflow-y-auto" data-thread={threadId}>
      <div className="mb-auto flex flex-col gap-2 p-3">
        {blocks.map((block, index) => (
          <Block
            key={block.key}
            block={block}
            live={underWay && index === blocks.length - 1}
            undo={undoTurn}
            undoWaits={undoWaits}
          />
        ))}
        <div className="flex flex-wrap items-center gap-1.5">
          {statusWords(status) === "" ? null : (
            <span className="text-caption text-muted-foreground">{statusWords(status)}</span>
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

  const sending = useIsMutating({ mutationKey: orpc.library.agent.send.mutationKey() }) > 0;

  const submit = () => {
    if (sending) {
      return;
    }

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

  const threadId = useStore(workspace.store, ({ composer: { target } }) =>
    target.kind === "asking" ? target.threadId : null,
  );

  const onThread = (next: string | null) => {
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
