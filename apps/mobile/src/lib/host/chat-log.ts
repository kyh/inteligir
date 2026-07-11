// ---------------------------------------------------------------------------
// The chat surface as a PURE value: a fold over the desktop agent's event
// stream (@repo/features/agent-events) plus the persisted-history rehydration.
// Mirrors the desktop renderer's agent-store semantics — streaming deltas
// accumulate into one assistant bubble, `message_end` replaces it with the
// final text (or drops a tool-only empty bubble), tool rows are ephemeral
// turn decoration (still-running ones are swept on `agent_end`, and history
// rehydration skips them entirely). chat.tsx owns nothing but
// `setLog(applyAgentEvent(log, event))`.
// ---------------------------------------------------------------------------

import type { AppAgentEvent } from "@repo/features/agent-events";
import type { ChatHistoryEntry } from "@repo/features/ipc-registry";
import { stripNoteContext } from "@repo/features/note-context";

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

export type ChatLog = {
  readonly items: readonly ChatItem[];
  /** True between agent_start and agent_end — the desktop agent is working. */
  readonly busy: boolean;
  /** Id of the assistant item currently receiving deltas, if any. */
  readonly streamingId: string | null;
  /** toolCallId → item id for tool rows created this turn. */
  readonly tools: ReadonlyMap<string, string>;
  readonly nextId: number;
};

export const emptyChatLog: ChatLog = {
  items: [],
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
 * auto-attached `[Context: …]` prefix (@repo/features/note-context) is
 * stripped so bubbles show the user's actual words. Built mutably in one
 * pass: `withItem`'s copy-per-append is fine for live events but O(n²) over a
 * whole history, and this reruns on every reconnect/foreground. */
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
      // (Completed rows stay, matching the desktop chat surface.)
      const running = new Set(log.tools.values());
      return {
        ...log,
        busy: false,
        streamingId: null,
        tools: new Map(),
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

    case "turn_error":
      return appendNotice(log, event.reason);

    case "tool_execution_start": {
      const id = allocId(log);
      const tools = new Map(log.tools);
      tools.set(event.toolCallId, id);
      return {
        ...withItem(log, { kind: "tool", id, toolName: event.toolName, state: "running" }),
        tools,
      };
    }

    case "tool_execution_end": {
      const id = log.tools.get(event.toolCallId);
      if (id === undefined) return log;
      const tools = new Map(log.tools);
      tools.delete(event.toolCallId);
      return {
        ...log,
        tools,
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
