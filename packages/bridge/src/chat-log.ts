// ---------------------------------------------------------------------------
// The chat surface as a PURE value: ONE fold over the agent's event stream
// (./agent-events) plus the persisted-history rehydration — shared by the
// workspace (which projects it into AI SDK UIMessages,
// @repo/workspace/stores/chat-log-view) and any companion chat screen that
// renders the items directly. Iso like ./note-context: no react/node/platform
// imports. Streaming deltas accumulate into one assistant bubble,
// `message_end` replaces it with the final text (or drops a tool-only empty
// bubble), tool rows are ephemeral turn decoration (still-running ones are
// swept on `agent_end`, and history rehydration skips them entirely).
//
// Items are the minimal RENDER list every surface shows; `detail` carries the
// per-item payload only some surfaces consume (tool args + result text, the
// turn_error kind that drives desktop's inline Re-authenticate link). Mobile
// ignores it; the desktop projection joins it back onto the item by id.
// ---------------------------------------------------------------------------

import type { AppAgentEvent } from "./agent-events";
import { stripNoteContext } from "./note-context";

/** Persisted-history wire shape for one chat entry (the `getAgentHistory`
 * channel's element type — the registry imports it from here). */
export type ChatHistoryEntry = {
  role: "user" | "assistant" | "tool";
  text: string;
  toolName?: string;
  toolCallId?: string;
  isError?: boolean;
};

export type ChatItem =
  | { readonly kind: "user"; readonly id: string; readonly text: string }
  | {
      readonly kind: "assistant";
      readonly id: string;
      readonly text: string;
      /** True while deltas are still accumulating into this bubble. */
      readonly streaming: boolean;
      /** Render as a failure surface (turn error / undelivered message). */
      readonly isError: boolean;
    }
  | {
      readonly kind: "tool";
      readonly id: string;
      readonly toolName: string;
      readonly state: "running" | "done" | "error";
    };

/** Surface-optional payload attached to an item by id. */
export type ChatItemDetail =
  | {
      readonly kind: "error";
      /** turn_error's cause ("auth" gets a re-authenticate affordance).
       * Error items without a detail entry are of unknown cause. */
      readonly errorKind: "auth" | "unknown";
    }
  | {
      readonly kind: "tool";
      readonly toolCallId: string;
      readonly args: unknown;
      /** Null while running; the tool's result (or error) text once ended. */
      readonly resultText: string | null;
    };

export type ChatLog = {
  readonly items: readonly ChatItem[];
  /** Per-item payload (tool args/result, error kind), keyed by item id. */
  readonly detail: ReadonlyMap<string, ChatItemDetail>;
  /** True between agent_start and agent_end — the agent is working. */
  readonly busy: boolean;
  /** Id of the assistant item currently receiving deltas, if any. */
  readonly streamingId: string | null;
  /** toolCallId → item id for tool rows created this turn. */
  readonly tools: ReadonlyMap<string, string>;
  readonly nextId: number;
};

export const emptyChatLog: ChatLog = {
  items: [],
  detail: new Map(),
  busy: false,
  streamingId: null,
  tools: new Map(),
  nextId: 0,
};

function allocId(log: ChatLog): string {
  return `c${log.nextId}`;
}

function withItem(log: ChatLog, item: ChatItem): ChatLog {
  return { ...log, items: [...log.items, item], nextId: log.nextId + 1 };
}

/** Append the optimistic bubble for a message this device just sent. */
export function appendUser(log: ChatLog, text: string): ChatLog {
  return withItem(log, { kind: "user", id: allocId(log), text });
}

/** Append a failure surface (e.g. "message wasn't delivered"). */
export function appendNotice(log: ChatLog, text: string): ChatLog {
  return withItem(log, {
    kind: "assistant",
    id: allocId(log),
    text,
    streaming: false,
    isError: true,
  });
}

/** Rebuild the log from persisted history (mount / reconnect). Tool entries
 * are skipped — they are live-turn decoration, not conversation. The user's
 * auto-attached `[Context: …]` prefix (./note-context) is stripped so bubbles
 * show the user's actual words. Built mutably in one pass: `withItem`'s
 * copy-per-append is fine for live events but O(n²) over a whole history, and
 * this reruns on every reconnect/foreground. */
export function logFromHistory(entries: readonly ChatHistoryEntry[]): ChatLog {
  const items: ChatItem[] = [];
  for (const entry of entries) {
    if (entry.role === "user") {
      items.push({ kind: "user", id: `c${items.length}`, text: stripNoteContext(entry.text) });
    } else if (entry.role === "assistant") {
      items.push({
        kind: "assistant",
        id: `c${items.length}`,
        text: entry.text,
        streaming: false,
        isError: entry.isError === true,
      });
    }
  }
  return { ...emptyChatLog, items, nextId: items.length };
}

/** Fold one agent event into the log. Total and pure — unknown/irrelevant
 * events return the log unchanged. */
export function applyAgentEvent(log: ChatLog, event: AppAgentEvent): ChatLog {
  switch (event.type) {
    case "agent_start":
      return log.busy ? log : { ...log, busy: true };

    case "agent_end": {
      // Sweep tool rows still marked running — the turn is over, so a row
      // whose end event never arrived would otherwise spin forever.
      // (Completed rows stay, with their detail.)
      const running = new Set(log.tools.values());
      let detail = log.detail;
      if (running.size > 0) {
        const swept = new Map(log.detail);
        for (const id of running) swept.delete(id);
        detail = swept;
      }
      return {
        ...log,
        busy: false,
        streamingId: null,
        tools: new Map(),
        detail,
        items: running.size > 0 ? log.items.filter((item) => !running.has(item.id)) : log.items,
      };
    }

    case "message_start": {
      if (event.role !== "assistant") return log;
      const id = allocId(log);
      return {
        ...withItem(log, { kind: "assistant", id, text: "", streaming: true, isError: false }),
        streamingId: id,
      };
    }

    case "message_update": {
      const sid = log.streamingId;
      if (sid === null) return log;
      return {
        ...log,
        items: log.items.map((item) =>
          item.id === sid && item.kind === "assistant"
            ? { ...item, text: item.text + event.delta }
            : item,
        ),
      };
    }

    case "message_end": {
      const sid = log.streamingId;
      if (sid === null || event.role !== "assistant") return log;
      if (event.stopReason === "error") {
        const errText =
          event.errorMessage ??
          (event.text.length > 0 ? event.text : "The model returned no response.");
        return {
          ...log,
          streamingId: null,
          items: log.items.map((item) =>
            item.id === sid && item.kind === "assistant"
              ? { ...item, text: errText, streaming: false, isError: true }
              : item,
          ),
        };
      }
      if (event.text.length === 0) {
        // Tool-only turns stream an empty bubble — drop it; the tool rows
        // already represent the activity.
        return { ...log, streamingId: null, items: log.items.filter((item) => item.id !== sid) };
      }
      return {
        ...log,
        streamingId: null,
        items: log.items.map((item) =>
          item.id === sid && item.kind === "assistant"
            ? { ...item, text: event.text, streaming: false }
            : item,
        ),
      };
    }

    case "turn_error": {
      const appended = appendNotice(log, event.reason);
      const id = appended.items[appended.items.length - 1]?.id;
      if (id === undefined) return appended;
      const detail = new Map(appended.detail);
      detail.set(id, { kind: "error", errorKind: event.kind });
      return { ...appended, detail };
    }

    case "tool_execution_start": {
      const id = allocId(log);
      const tools = new Map(log.tools);
      tools.set(event.toolCallId, id);
      const detail = new Map(log.detail);
      detail.set(id, {
        kind: "tool",
        toolCallId: event.toolCallId,
        args: event.args,
        resultText: null,
      });
      return {
        ...withItem(log, { kind: "tool", id, toolName: event.toolName, state: "running" }),
        tools,
        detail,
      };
    }

    case "tool_execution_end": {
      const id = log.tools.get(event.toolCallId);
      if (id === undefined) return log;
      const tools = new Map(log.tools);
      tools.delete(event.toolCallId);
      const detail = new Map(log.detail);
      const existing = detail.get(id);
      if (existing?.kind === "tool") {
        detail.set(id, { ...existing, resultText: event.resultText });
      }
      return {
        ...log,
        tools,
        detail,
        items: log.items.map((item) =>
          item.id === id && item.kind === "tool"
            ? { ...item, state: event.isError ? "error" : "done" }
            : item,
        ),
      };
    }

    case "queue_update":
      return log;
  }
}
