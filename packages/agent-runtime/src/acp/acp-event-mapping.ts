// ACP has no turn ids and no item lifecycle: chunks arrive bare and a tool call is born by
// tool_call then mutated by tool_call_update, so this mapper mints one message and one reasoning
// item id per turn.

import type { ThreadEventFileChange, ThreadEventItemStatus } from "@repo/domain/provider-event";
import type { ThreadEventScope } from "@repo/domain/thread-event-scope";
import type {
  ContentBlock,
  PlanEntry,
  PromptResponse,
  SessionNotification,
  ToolCallLocation,
  ToolCallUpdate,
} from "@zed-industries/agent-client-protocol";
import { jsonObjectSchema } from "../vocabulary/json-value.js";
import type { JsonObject } from "../vocabulary/json-value.js";
import type {
  ProviderEvent,
  ProviderEventItem,
  ProviderEventPlanStep,
} from "../vocabulary/provider-event.js";

type StopReason = PromptResponse["stopReason"];

type SessionUpdate = SessionNotification["update"];

type SessionUpdateOf<Kind extends SessionUpdate["sessionUpdate"]> = Extract<
  SessionUpdate,
  { sessionUpdate: Kind }
>;

export interface AcpTurnContext {
  threadId: string;
  providerThreadId: string;
  turnId: string;
}

interface OpenToolCall {
  title: string;
  kind: string;
  status: ThreadEventItemStatus;
  locations: ToolCallLocation[];
  diffs: ThreadEventFileChange[];
  outputText: string;
  rawInput?: JsonObject;
}

interface ToolCallContentCarrier {
  content?: ToolCallUpdate["content"];
}

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

const PLAN_STEP_STATUS = {
  completed: "completed",
  in_progress: "active",
  pending: "pending",
} satisfies Record<PlanEntry["status"], ProviderEventPlanStep["status"]>;

const mapPlanEntry = (entry: PlanEntry): ProviderEventPlanStep => ({
  status: PLAN_STEP_STATUS[entry.status],
  step: entry.content,
});

const absorbContent = (
  open: OpenToolCall,
  update: ToolCallUpdate | ToolCallContentCarrier,
): void => {
  for (const content of update.content ?? []) {
    if (content.type === "diff") {
      const isNewFile = content.oldText === undefined || content.oldText === null;
      const change: ThreadEventFileChange = {
        kind: isNewFile ? "add" : "update",
        path: content.path,
      };
      open.diffs.push(change);
    } else if (content.type === "content" && content.content.type === "text") {
      open.outputText += content.content.text;
    }
  }
};

const applyToolCallUpdate = (
  open: OpenToolCall,
  update: SessionUpdateOf<"tool_call_update">,
): void => {
  if (update.title !== undefined && update.title !== null) {
    open.title = update.title;
  }
  if (update.kind !== undefined && update.kind !== null) {
    open.kind = update.kind;
  }
  if (update.locations !== undefined && update.locations !== null) {
    open.locations = [...update.locations];
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
  absorbContent(open, update);
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
  if (open.kind === "execute") {
    const item: ProviderEventItem = {
      approvalStatus: null,
      command: open.title,
      cwd: "",
      id,
      status: open.status,
      type: "commandExecution",
    };
    if (open.outputText !== "") {
      item.aggregatedOutput = open.outputText;
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
  if (open.outputText !== "") {
    item.result = open.outputText;
  }
  return item;
};

export class AcpTurnMapper {
  readonly #ctx: AcpTurnContext;
  #messageOpen = false;
  #messageText = "";
  #reasoningOpen = false;
  #reasoningText = "";
  readonly #toolCalls = new Map<string, OpenToolCall>();

  constructor(ctx: AcpTurnContext) {
    this.#ctx = ctx;
  }

  get turnId(): string {
    return this.#ctx.turnId;
  }

  #scope(): ThreadEventScope {
    return { kind: "turn", turnId: this.#ctx.turnId };
  }

  #threadData() {
    return {
      providerThreadId: this.#ctx.providerThreadId,
      scope: this.#scope(),
      threadId: this.#ctx.threadId,
    };
  }

  #messageItemId(): string {
    return `${this.#ctx.turnId}:message`;
  }

  #reasoningItemId(): string {
    return `${this.#ctx.turnId}:reasoning`;
  }

  started(): ProviderEvent[] {
    return [{ type: "turn/started", ...this.#threadData() }];
  }

  update(notification: SessionNotification): ProviderEvent[] {
    const { update } = notification;
    switch (update.sessionUpdate) {
      case "agent_message_chunk": {
        return this.#appendMessage(update.content);
      }
      case "agent_thought_chunk": {
        return this.#appendThought(update.content);
      }
      case "tool_call": {
        return this.#openToolCall(update);
      }
      case "tool_call_update": {
        return this.#updateToolCall(update);
      }
      case "plan": {
        return [
          {
            plan: update.entries.map(mapPlanEntry),
            type: "turn/plan/updated",
            ...this.#threadData(),
          },
        ];
      }
      case "user_message_chunk":
      case "available_commands_update":
      case "current_mode_update": {
        return [];
      }
      // no default
    }
  }

  #appendMessage(content: ContentBlock): ProviderEvent[] {
    if (content.type !== "text") {
      return [];
    }
    const events: ProviderEvent[] = [];
    if (!this.#messageOpen) {
      this.#messageOpen = true;
      events.push({
        item: { id: this.#messageItemId(), text: "", type: "agentMessage" },
        type: "item/started",
        ...this.#threadData(),
      });
    }
    this.#messageText += content.text;
    events.push({
      delta: content.text,
      itemId: this.#messageItemId(),
      type: "item/agentMessage/delta",
      ...this.#threadData(),
    });
    return events;
  }

  #appendThought(content: ContentBlock): ProviderEvent[] {
    if (content.type !== "text") {
      return [];
    }
    const events: ProviderEvent[] = [];
    if (!this.#reasoningOpen) {
      this.#reasoningOpen = true;
      events.push({
        item: { content: [], id: this.#reasoningItemId(), summary: [], type: "reasoning" },
        type: "item/started",
        ...this.#threadData(),
      });
    }
    this.#reasoningText += content.text;
    events.push({
      delta: content.text,
      itemId: this.#reasoningItemId(),
      type: "item/reasoning/textDelta",
      ...this.#threadData(),
    });
    return events;
  }

  #openToolCall(update: SessionUpdateOf<"tool_call">): ProviderEvent[] {
    const open: OpenToolCall = {
      diffs: [],
      kind: update.kind ?? "other",
      locations: [...(update.locations ?? [])],
      outputText: "",
      status: mapToolStatus(update.status),
      title: update.title,
    };
    const parsedInput = jsonObjectSchema.safeParse(update.rawInput);
    if (update.rawInput !== undefined && parsedInput.success) {
      open.rawInput = parsedInput.data;
    }
    absorbContent(open, update);
    this.#toolCalls.set(update.toolCallId, open);
    return [
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
    if (open.status === "completed" || open.status === "failed") {
      this.#toolCalls.delete(update.toolCallId);
      return [
        {
          item: toolItem(update.toolCallId, open),
          type: "item/completed",
          ...this.#threadData(),
        },
      ];
    }
    return [
      {
        itemId: update.toolCallId,
        message: open.title,
        type: "item/toolCall/progress",
        ...this.#threadData(),
      },
    ];
  }

  completed(stopReason: StopReason): ProviderEvent[] {
    const events = this.#closeOpenItems(stopReason === "cancelled" ? "interrupted" : "completed");
    events.push({
      providerThreadId: this.#ctx.providerThreadId,
      scope: this.#scope(),
      status: mapStopReason(stopReason),
      threadId: this.#ctx.threadId,
      type: "turn/completed",
    });
    return events;
  }

  failed(message: string): ProviderEvent[] {
    const events = this.#closeOpenItems("failed");
    events.push(
      {
        errorInfo: { category: "internal", httpStatusCode: null, providerCode: null },
        message,
        type: "provider/error",
        ...this.#threadData(),
      },
      {
        error: { message },
        providerThreadId: this.#ctx.providerThreadId,
        scope: this.#scope(),
        status: "failed",
        threadId: this.#ctx.threadId,
        type: "turn/completed",
      },
    );
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
    if (this.#reasoningOpen) {
      events.push({
        item: {
          content: [this.#reasoningText],
          id: this.#reasoningItemId(),
          summary: [],
          type: "reasoning",
        },
        type: "item/completed",
        ...this.#threadData(),
      });
      this.#reasoningOpen = false;
    }
    if (this.#messageOpen) {
      events.push({
        item: { id: this.#messageItemId(), text: this.#messageText, type: "agentMessage" },
        type: "item/completed",
        ...this.#threadData(),
      });
      this.#messageOpen = false;
    }
    return events;
  }
}
