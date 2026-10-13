// ACP has no turn ids and no item lifecycle: chunks arrive bare and a tool call is born by
// tool_call then mutated by tool_call_update, so this mapper mints the item ids. A turn holds as
// many message and reasoning items as the agent spoke: one ends where its chunks' messageId
// changes, or where a tool call opens (claude's adapter sends no messageId), because one id per
// turn would draw a preamble and its answer as one item above every tool call.

import type {
  ProviderFailure,
  ThreadEventFileChange,
  ThreadEventItemStatus,
} from "@repo/domain/provider-event";
import { turnScope } from "@repo/domain/thread-event-scope";
import type {
  ContentChunk,
  PromptResponse,
  SessionNotification,
  ToolCallContent,
  ToolCallLocation,
  ToolCallUpdate,
} from "@agentclientprotocol/sdk";
import { z } from "zod";
import type { ProviderEvent, ProviderEventItem } from "../vocabulary/provider-event.js";

type StopReason = PromptResponse["stopReason"];

type SessionUpdate = SessionNotification["update"];

type SessionUpdateOf<Kind extends SessionUpdate["sessionUpdate"]> = Extract<
  SessionUpdate,
  { sessionUpdate: Kind }
>;

export interface AcpTurnContext {
  threadId: string;
  turnId: string;
}

const jsonObjectSchema = z.record(z.string(), z.json());

interface OpenToolCall {
  title: string;
  kind: string;
  name: string | null;
  status: ThreadEventItemStatus;
  locations: ToolCallLocation[];
  diffs: ThreadEventFileChange[];
  outputText: string;
  rawOutputText: string;
  rawInput?: z.infer<typeof jsonObjectSchema>;
}

// codex names every shell command this but kinds it by what the command does, so an `ls` arrives
// as a read and the kind alone would land it as a tool call.
const CODEX_SHELL_TOOL = "exec_command";

// codex reports a shell command's output here alone, never as content.
const commandRawOutputSchema = z.looseObject({ formatted_output: z.string() });

const outputOf = (open: OpenToolCall): string =>
  open.outputText === "" ? open.rawOutputText : open.outputText;

// the client advertises no notices, since nothing here can show one yet, so codex speaks its own
// warnings as message text. every chunk the model writes carries a messageId and this one never
// does, so the pair tells the adapter's voice from the model's.
const CODEX_WARNING = /^Warning: (?<message>[\s\S]+?)\n\n$/u;

const adapterWarning = (chunk: ContentChunk): string | null => {
  if (
    chunk.content.type !== "text" ||
    (chunk.messageId !== undefined && chunk.messageId !== null)
  ) {
    return null;
  }
  return CODEX_WARNING.exec(chunk.content.text)?.groups?.message ?? null;
};

const mapToolStatus = (status: string | null | undefined): ThreadEventItemStatus => {
  if (status === "completed" || status === "failed") {
    return status;
  }
  return "pending";
};

const mapStopReason = (stopReason: StopReason): "completed" | "failed" | "interrupted" => {
  switch (stopReason) {
    case "cancelled": {
      return "interrupted";
    }
    case "refusal":
    case "max_tokens":
    case "max_turn_requests": {
      return "failed";
    }
    case "end_turn": {
      return "completed";
    }
    // no default
  }
};

// a content collection replaces the one before it (the protocol's rule): claude sends a Bash call's
// description as content, then its output, which appending would run together.
const replaceContent = (
  open: OpenToolCall,
  content: ToolCallContent[] | null | undefined,
): void => {
  if (content === undefined || content === null) {
    return;
  }
  open.diffs = [];
  open.outputText = "";
  for (const entry of content) {
    if (entry.type === "diff") {
      const isNewFile = entry.oldText === undefined || entry.oldText === null;
      open.diffs.push({ kind: isNewFile ? "add" : "update", path: entry.path });
    } else if (entry.type === "content" && entry.content.type === "text") {
      open.outputText += entry.content.text;
    }
  }
};

// a tool_call is the first update of its call: every field it names lands as a later update's
// would, over the defaults a call starts from.
const applyToolCallUpdate = (open: OpenToolCall, update: ToolCallUpdate): void => {
  if (update.title !== undefined && update.title !== null) {
    open.title = update.title;
  }
  if (update.kind !== undefined && update.kind !== null) {
    open.kind = update.kind;
  }
  if (update.name !== undefined && update.name !== null) {
    open.name = update.name;
  }
  if (update.locations !== undefined && update.locations !== null) {
    open.locations = [...update.locations];
  }
  if (update.rawOutput !== undefined) {
    const rawOutput = commandRawOutputSchema.safeParse(update.rawOutput);
    open.rawOutputText = rawOutput.success ? rawOutput.data.formatted_output : "";
  }
  if (update.rawInput !== undefined && update.rawInput !== null) {
    const parsedInput = jsonObjectSchema.safeParse(update.rawInput);
    if (parsedInput.success) {
      open.rawInput = parsedInput.data;
    }
  }
  if (update.status !== undefined && update.status !== null) {
    open.status = mapToolStatus(update.status);
  }
  replaceContent(open, update.content);
};

// file-shaped kinds become fileChange items: the commit hold stages a turn's write set from
// these.
const toolItem = (id: string, open: OpenToolCall): ProviderEventItem => {
  if (open.kind === "edit" || open.kind === "delete" || open.kind === "move") {
    const byPath = new Map<string, ThreadEventFileChange>();
    for (const diff of open.diffs) {
      byPath.set(diff.path, diff);
    }
    for (const location of open.locations) {
      if (!byPath.has(location.path)) {
        byPath.set(location.path, {
          kind: open.kind === "delete" ? "delete" : "update",
          path: location.path,
        });
      }
    }
    return {
      approvalStatus: null,
      changes: [...byPath.values()],
      id,
      status: open.status,
      type: "fileChange",
    };
  }
  const output = outputOf(open);
  if (open.kind === "execute" || open.name === CODEX_SHELL_TOOL) {
    const item: ProviderEventItem = {
      approvalStatus: null,
      command: open.title,
      cwd: "",
      id,
      status: open.status,
      type: "commandExecution",
    };
    if (output !== "") {
      item.aggregatedOutput = output;
    }
    return item;
  }
  const item: ProviderEventItem = {
    id,
    status: open.status,
    tool: open.title,
    type: "toolCall",
  };
  if (open.rawInput !== undefined) {
    item.arguments = open.rawInput;
  }
  if (output !== "") {
    item.result = output;
  }
  return item;
};

// a chunk's messageId when the adapter names one; a chunk naming none continues what is open.
const chunkMessageId = (chunk: ContentChunk): string | null => chunk.messageId ?? null;

const turnEventData = (ctx: AcpTurnContext) => ({
  scope: turnScope(ctx.turnId),
  threadId: ctx.threadId,
});

const MESSAGE_STREAM = {
  deltaType: "item/agentMessage/delta",
  idSegment: "message",
  itemType: "agentMessage",
} as const;

const REASONING_STREAM = {
  deltaType: "item/reasoning/textDelta",
  idSegment: "reasoning",
  itemType: "reasoning",
} as const;

// what the agent said, or what it thought, as one item per spoken run.
interface TextStream {
  // both name a message and they differ; a chunk naming none continues the open item.
  movedPast: (messageId: string | null) => boolean;
  append: (text: string, messageId: string | null) => ProviderEvent[];
  close: () => ProviderEvent[];
}

interface OpenTextItem {
  id: string;
  messageId: string | null;
  text: string;
}

const textStream = (
  kind: typeof MESSAGE_STREAM | typeof REASONING_STREAM,
  ctx: AcpTurnContext,
): TextStream => {
  let open: OpenTextItem | null = null;
  let count = 0;

  const movedPast = (messageId: string | null): boolean =>
    open !== null && open.messageId !== null && messageId !== null && open.messageId !== messageId;

  const close = (): ProviderEvent[] => {
    const closing = open;
    if (closing === null) {
      return [];
    }
    open = null;
    return [
      {
        item: { id: closing.id, text: closing.text, type: kind.itemType },
        type: "item/completed",
        ...turnEventData(ctx),
      },
    ];
  };

  const append = (text: string, messageId: string | null): ProviderEvent[] => {
    const events: ProviderEvent[] = [];
    let current = open;
    if (current === null || movedPast(messageId)) {
      events.push(...close());
      count += 1;
      current = { id: `${ctx.turnId}:${kind.idSegment}:${count}`, messageId, text: "" };
      open = current;
      events.push({
        item: { id: current.id, text: "", type: kind.itemType },
        type: "item/started",
        ...turnEventData(ctx),
      });
    }
    current.messageId ??= messageId;
    current.text += text;
    events.push({
      delta: text,
      itemId: current.id,
      type: kind.deltaType,
      ...turnEventData(ctx),
    });
    return events;
  };

  return { append, close, movedPast };
};

// the other stream's item ends first when the stream moved past its message.
const speak = (stream: TextStream, other: TextStream, chunk: ContentChunk): ProviderEvent[] => {
  if (chunk.content.type !== "text") {
    return [];
  }
  const messageId = chunkMessageId(chunk);
  return [
    ...(other.movedPast(messageId) ? other.close() : []),
    ...stream.append(chunk.content.text, messageId),
  ];
};

export class AcpTurnMapper {
  readonly #ctx: AcpTurnContext;
  readonly #message: TextStream;
  readonly #reasoning: TextStream;
  readonly #toolCalls = new Map<string, OpenToolCall>();

  constructor(ctx: AcpTurnContext) {
    this.#ctx = ctx;
    this.#message = textStream(MESSAGE_STREAM, ctx);
    this.#reasoning = textStream(REASONING_STREAM, ctx);
  }

  get turnId(): string {
    return this.#ctx.turnId;
  }

  #threadData() {
    return turnEventData(this.#ctx);
  }

  started(): ProviderEvent[] {
    return [{ type: "turn/started", ...this.#threadData() }];
  }

  update(notification: SessionNotification): ProviderEvent[] {
    const { update } = notification;
    switch (update.sessionUpdate) {
      case "agent_message_chunk": {
        const warning = adapterWarning(update);
        return warning === null
          ? speak(this.#message, this.#reasoning, update)
          : [this.#notice("warning", warning)];
      }
      case "agent_thought_chunk": {
        return speak(this.#reasoning, this.#message, update);
      }
      case "tool_call": {
        return this.#openToolCall(update);
      }
      case "tool_call_update": {
        return this.#updateToolCall(update);
      }
      case "notice": {
        const { description, severity, title } = update;
        const message =
          description === undefined || description === null ? title : `${title}: ${description}`;
        return [this.#notice(severity, message)];
      }
      // no pinned adapter sends a plan, even asked for a todo list, so the grammar carries none.
      case "plan":
      case "user_message_chunk":
      case "available_commands_update":
      case "current_mode_update":
      case "config_option_update":
      case "session_info_update":
      case "usage_update":
      case "plan_update":
      case "plan_removed":
      case "compaction_update":
      case "compaction_summary_chunk": {
        return [];
      }
      // no default
    }
  }

  #notice(severity: string, message: string): ProviderEvent {
    return { message, severity, type: "provider/notice", ...this.#threadData() };
  }

  #openToolCall(update: SessionUpdateOf<"tool_call">): ProviderEvent[] {
    const open: OpenToolCall = {
      diffs: [],
      kind: "other",
      locations: [],
      name: null,
      outputText: "",
      rawOutputText: "",
      status: "pending",
      title: update.title,
    };
    applyToolCallUpdate(open, update);
    this.#toolCalls.set(update.toolCallId, open);
    // a tool call ends what the agent was saying or thinking: text after it is a new item, so the
    // timeline draws each where it happened.
    return [
      ...this.#reasoning.close(),
      ...this.#message.close(),
      {
        item: toolItem(update.toolCallId, open),
        type: "item/started",
        ...this.#threadData(),
      },
    ];
  }

  #updateToolCall(update: SessionUpdateOf<"tool_call_update">): ProviderEvent[] {
    const open = this.#toolCalls.get(update.toolCallId);
    if (open === undefined) {
      return [];
    }
    applyToolCallUpdate(open, update);
    // a running call's update lands with the item it completes as: nothing draws it before.
    if (open.status !== "completed" && open.status !== "failed") {
      return [];
    }
    this.#toolCalls.delete(update.toolCallId);
    return [
      {
        item: toolItem(update.toolCallId, open),
        type: "item/completed",
        ...this.#threadData(),
      },
    ];
  }

  completed(stopReason: StopReason): ProviderEvent[] {
    const events = this.#closeOpenItems(stopReason === "cancelled" ? "interrupted" : "completed");
    events.push({
      status: mapStopReason(stopReason),
      type: "turn/completed",
      ...this.#threadData(),
    });
    return events;
  }

  failed(message: string, failure?: ProviderFailure): ProviderEvent[] {
    const events = this.#closeOpenItems("failed");
    const error: ProviderEvent = { message, type: "provider/error", ...this.#threadData() };
    if (failure !== undefined) {
      error.failure = failure;
    }
    events.push(error, {
      error: { message },
      status: "failed",
      type: "turn/completed",
      ...this.#threadData(),
    });
    return events;
  }

  #closeOpenItems(toolStatus: ThreadEventItemStatus): ProviderEvent[] {
    const events: ProviderEvent[] = [];
    for (const [id, open] of this.#toolCalls) {
      events.push({
        item: toolItem(id, { ...open, status: toolStatus }),
        type: "item/completed",
        ...this.#threadData(),
      });
    }
    this.#toolCalls.clear();
    events.push(...this.#reasoning.close(), ...this.#message.close());
    return events;
  }
}
