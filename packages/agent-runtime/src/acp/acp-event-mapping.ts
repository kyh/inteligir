// ACP session/update → ProviderEvent, pure. The provider-event vocabulary is
// the ONE internal grammar (the app's event-mapping and ThreadService stay
// untouched by the harness swap), so every ACP notion lands as an event bb's
// grammar already names — never a divergent shape.
//
// ACP has no turn ids and no item lifecycle: chunks arrive bare and a tool
// call is born by `tool_call` then mutated by `tool_call_update`. The turn
// context OWNS the missing identity: the runtime mints a turn id per prompt,
// and this mapper mints item ids (one message item and one reasoning item per
// turn; tool calls keep the agent's own toolCallId) and remembers enough item
// state to emit faithful `item/completed` shapes when a call settles or the
// turn ends.

import type {
  PlanEntry,
  PromptResponse,
  SessionNotification,
  ToolCallLocation,
  ToolCallUpdate,
} from "@zed-industries/agent-client-protocol";
import { jsonObjectSchema, type JsonObject } from "../vocabulary/json-value.js";

type StopReason = PromptResponse["stopReason"];
import type { ThreadEventFileChange, ThreadEventItemStatus } from "@repo/domain/provider-event";
import type { ThreadEventScope } from "@repo/domain/thread-event-scope";
import type {
  ProviderEvent,
  ProviderEventItem,
  ProviderEventPlanStep,
} from "../vocabulary/provider-event.js";

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

/** Per-turn mapper state; one instance lives for one prompt's duration. */
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
    const update = notification.update;
    switch (update.sessionUpdate) {
      case "agent_message_chunk": {
        if (update.content.type !== "text") return [];
        const events: ProviderEvent[] = [];
        if (!this.#messageOpen) {
          this.#messageOpen = true;
          events.push({
            type: "item/started",
            item: { type: "agentMessage", id: this.#messageItemId(), text: "" },
            ...this.#threadData(),
          });
        }
        this.#messageText += update.content.text;
        events.push({
          type: "item/agentMessage/delta",
          itemId: this.#messageItemId(),
          delta: update.content.text,
          ...this.#threadData(),
        });
        return events;
      }
      case "agent_thought_chunk": {
        if (update.content.type !== "text") return [];
        const events: ProviderEvent[] = [];
        if (!this.#reasoningOpen) {
          this.#reasoningOpen = true;
          events.push({
            type: "item/started",
            item: { type: "reasoning", id: this.#reasoningItemId(), summary: [], content: [] },
            ...this.#threadData(),
          });
        }
        this.#reasoningText += update.content.text;
        events.push({
          type: "item/reasoning/textDelta",
          itemId: this.#reasoningItemId(),
          delta: update.content.text,
          ...this.#threadData(),
        });
        return events;
      }
      case "tool_call": {
        const open: OpenToolCall = {
          diffs: [],
          kind: update.kind ?? "other",
          locations: [...(update.locations ?? [])],
          outputText: "",
          status: mapToolStatus(update.status),
          title: update.title,
        };
        {
          const parsedInput = jsonObjectSchema.safeParse(update.rawInput);
          if (update.rawInput !== undefined && parsedInput.success) {
            open.rawInput = parsedInput.data;
          }
        }
        this.#absorbContent(open, update);
        this.#toolCalls.set(update.toolCallId, open);
        return [
          {
            type: "item/started",
            item: this.#toolItem(update.toolCallId, open),
            ...this.#threadData(),
          },
        ];
      }
      case "tool_call_update": {
        const open = this.#toolCalls.get(update.toolCallId);
        if (open === undefined) return [];
        if (update.title != null) open.title = update.title;
        if (update.kind != null) open.kind = update.kind;
        if (update.locations != null) open.locations = [...update.locations];
        if (update.rawInput !== undefined && update.rawInput !== null) {
          const parsedInput = jsonObjectSchema.safeParse(update.rawInput);
          if (parsedInput.success) open.rawInput = parsedInput.data;
        }
        if (update.status != null) open.status = mapToolStatus(update.status);
        this.#absorbContent(open, update);
        if (open.status === "completed" || open.status === "failed") {
          this.#toolCalls.delete(update.toolCallId);
          return [
            {
              type: "item/completed",
              item: this.#toolItem(update.toolCallId, open),
              ...this.#threadData(),
            },
          ];
        }
        return [
          {
            type: "item/toolCall/progress",
            itemId: update.toolCallId,
            message: open.title,
            ...this.#threadData(),
          },
        ];
      }
      case "plan": {
        return [
          {
            type: "turn/plan/updated",
            plan: update.entries.map(mapPlanEntry),
            ...this.#threadData(),
          },
        ];
      }
      case "user_message_chunk":
      case "available_commands_update":
      case "current_mode_update":
        return [];
    }
  }

  /** The prompt settled: close every open item, then the turn itself. */
  completed(stopReason: StopReason): ProviderEvent[] {
    const events = this.#closeOpenItems(stopReason === "cancelled" ? "interrupted" : "completed");
    events.push({
      type: "turn/completed",
      threadId: this.#ctx.threadId,
      providerThreadId: this.#ctx.providerThreadId,
      status: mapStopReason(stopReason),
      scope: this.#scope(),
    });
    return events;
  }

  failed(message: string): ProviderEvent[] {
    const events = this.#closeOpenItems("failed");
    events.push({
      type: "provider/error",
      message,
      errorInfo: { category: "internal", providerCode: null, httpStatusCode: null },
      ...this.#threadData(),
    });
    events.push({
      type: "turn/completed",
      threadId: this.#ctx.threadId,
      providerThreadId: this.#ctx.providerThreadId,
      status: "failed",
      error: { message },
      scope: this.#scope(),
    });
    return events;
  }

  #closeOpenItems(toolStatus: ThreadEventItemStatus): ProviderEvent[] {
    const events: ProviderEvent[] = [];
    for (const [id, open] of this.#toolCalls) {
      events.push({
        type: "item/completed",
        item: this.#toolItem(id, { ...open, status: toolStatus }),
        ...this.#threadData(),
      });
    }
    this.#toolCalls.clear();
    if (this.#reasoningOpen) {
      events.push({
        type: "item/completed",
        item: {
          type: "reasoning",
          id: this.#reasoningItemId(),
          summary: [],
          content: [this.#reasoningText],
        },
        ...this.#threadData(),
      });
      this.#reasoningOpen = false;
    }
    if (this.#messageOpen) {
      events.push({
        type: "item/completed",
        item: { type: "agentMessage", id: this.#messageItemId(), text: this.#messageText },
        ...this.#threadData(),
      });
      this.#messageOpen = false;
    }
    return events;
  }

  #absorbContent(open: OpenToolCall, update: ToolCallUpdate | ToolCallContentCarrier): void {
    for (const content of update.content ?? []) {
      if (content.type === "diff") {
        const change: ThreadEventFileChange = {
          kind: content.oldText == null ? "add" : "update",
          path: content.path,
        };
        open.diffs.push(change);
      } else if (content.type === "content" && content.content.type === "text") {
        open.outputText += content.content.text;
      }
    }
  }

  /** The item an ACP tool call lands as, by its declared kind: file edits are
   * fileChange items (the commit hold stages a turn's write set FROM these),
   * executions are commands, and everything else stays a tool call. */
  #toolItem(id: string, open: OpenToolCall): ProviderEventItem {
    if (open.kind === "edit" || open.kind === "delete" || open.kind === "move") {
      const byPath = new Map<string, ThreadEventFileChange>();
      for (const diff of open.diffs) byPath.set(diff.path, diff);
      for (const location of open.locations) {
        if (!byPath.has(location.path)) {
          byPath.set(location.path, {
            kind: open.kind === "delete" ? "delete" : "update",
            path: location.path,
          });
        }
      }
      return {
        type: "fileChange",
        id,
        changes: [...byPath.values()],
        status: open.status,
        approvalStatus: null,
      };
    }
    if (open.kind === "execute") {
      const item: ProviderEventItem = {
        type: "commandExecution",
        id,
        command: open.title,
        cwd: "",
        status: open.status,
        approvalStatus: null,
      };
      if (open.outputText !== "") item.aggregatedOutput = open.outputText;
      return item;
    }
    const item: ProviderEventItem = {
      type: "toolCall",
      id,
      tool: open.title,
      status: open.status,
    };
    if (open.rawInput !== undefined) item.arguments = open.rawInput;
    if (open.outputText !== "") item.result = open.outputText;
    return item;
  }
}

interface ToolCallContentCarrier {
  content?: ToolCallUpdate["content"];
}

function mapToolStatus(status: string | null | undefined): ThreadEventItemStatus {
  switch (status) {
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    default:
      return "pending";
  }
}

function mapStopReason(stopReason: StopReason): "completed" | "failed" | "interrupted" {
  switch (stopReason) {
    case "cancelled":
      return "interrupted";
    case "refusal":
    case "max_tokens":
    case "max_turn_requests":
      return "failed";
    default:
      return "completed";
  }
}

function mapPlanEntry(entry: PlanEntry): ProviderEventPlanStep {
  return {
    step: entry.content,
    status:
      entry.status === "completed"
        ? "completed"
        : entry.status === "in_progress"
          ? "active"
          : "pending",
  };
}
