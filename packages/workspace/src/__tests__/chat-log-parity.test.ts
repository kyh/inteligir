// ---------------------------------------------------------------------------
// Desktop parity: the shared @repo/bridge/chat-log fold + the UIMessage
// projection (@repo/workspace/stores/chat-log-view) must reproduce what the
// renderer's OLD inline fold produced. `foldOldDesktop` below is a verbatim
// transcription of agent-store.ts's pre-extraction subscribeAgentEvents /
// historyToChatMessages (main @ bc097a1e), reduced to a pure fold (voice +
// queue side effects dropped — they never touched messages). It is FROZEN
// history — do not "fix" it; if the shared reducer's semantics change on
// purpose, pin the difference like the history-isError divergence below.
//
// Messages are compared modulo `id` (the old fold allocated m_N from a global
// counter, the shared log allocates c_N per log; ids are ephemeral render
// keys, never persisted), and parity is asserted after EVERY event, not just
// at rest.
// ---------------------------------------------------------------------------

import type { DynamicToolUIPart, TextUIPart, UIMessage } from "ai";
import { describe, expect, it } from "vitest";

import type { AppAgentEvent } from "@repo/bridge/agent-events";
import { applyAgentEvent, emptyChatLog, logFromHistory, type ChatLog } from "@repo/bridge/chat-log";
import type { ChatHistoryEntry } from "@repo/bridge/chat-log";
import { stripNoteContext } from "@repo/bridge/note-context";
import {
  chatEventFixtures,
  historyFixture,
  historyWithErrorFixture,
} from "@repo/bridge/__tests__/chat-log-fixtures";
import { projectChatLog, type ChatMessageMetadata } from "@repo/workspace/stores/chat-log-view";

type OldChatMessage = UIMessage<ChatMessageMetadata>;

// ---- the frozen pre-extraction fold ----------------------------------------
// Helpers transcribed verbatim (hoisted to module scope for lint — none
// capture fold state).

function textPart(text: string, state?: TextUIPart["state"]): TextUIPart {
  return state ? { type: "text", text, state } : { type: "text", text };
}
function toolPartRunning(toolCallId: string, toolName: string, args: unknown): DynamicToolUIPart {
  return { type: "dynamic-tool", toolCallId, toolName, state: "input-available", input: args };
}
function toolPartDone(
  toolCallId: string,
  toolName: string,
  args: unknown,
  resultText: string,
): DynamicToolUIPart {
  return {
    type: "dynamic-tool",
    toolCallId,
    toolName,
    state: "output-available",
    input: args,
    output: resultText,
  };
}
function toolPartError(
  toolCallId: string,
  toolName: string,
  args: unknown,
  errorText: string,
): DynamicToolUIPart {
  return {
    type: "dynamic-tool",
    toolCallId,
    toolName,
    state: "output-error",
    input: args,
    errorText,
  };
}
function mapMessageWithTextPart(
  msg: OldChatMessage,
  mutate: (part: TextUIPart) => TextUIPart,
): OldChatMessage {
  const first = msg.parts[0];
  if (!first || first.type !== "text") return msg;
  const next = mutate(first);
  if (next === first) return msg;
  return { ...msg, parts: [next, ...msg.parts.slice(1)] };
}
function replaceToolPart(msg: OldChatMessage, next: DynamicToolUIPart): OldChatMessage {
  const first = msg.parts[0];
  if (!first || first.type !== "dynamic-tool") return msg;
  if (next === first) return msg;
  return { ...msg, parts: [next, ...msg.parts.slice(1)] };
}

function makeOldFold(): (event: AppAgentEvent) => OldChatMessage[] {
  let messages: OldChatMessage[] = [];
  let streamingMsgId: string | null = null;
  const toolMsgIds = new Map<string, string>();
  let nextMsgId = 0;
  const makeId = () => `m_${nextMsgId++}`;

  function assistantTextMessage(text: string, streaming = false): OldChatMessage {
    return {
      id: makeId(),
      role: "assistant",
      parts: [textPart(text, streaming ? "streaming" : undefined)],
    };
  }
  function assistantToolMessage(part: DynamicToolUIPart): OldChatMessage {
    return { id: makeId(), role: "assistant", parts: [part] };
  }

  return (event: AppAgentEvent): OldChatMessage[] => {
    switch (event.type) {
      case "agent_end": {
        streamingMsgId = null;
        const sweepIds = new Set(toolMsgIds.values());
        toolMsgIds.clear();
        if (sweepIds.size > 0) messages = messages.filter((m) => !sweepIds.has(m.id));
        break;
      }
      case "message_start": {
        if (event.role !== "assistant") break;
        const msg = assistantTextMessage("", true);
        streamingMsgId = msg.id;
        messages = [...messages, msg];
        break;
      }
      case "message_update": {
        if (streamingMsgId === null) break;
        const sid = streamingMsgId;
        const delta = event.delta;
        messages = messages.map((m) =>
          m.id === sid
            ? mapMessageWithTextPart(m, (part) => ({ ...part, text: part.text + delta }))
            : m,
        );
        break;
      }
      case "message_end": {
        if (streamingMsgId === null || event.role !== "assistant") break;
        const sid = streamingMsgId;
        const { text } = event;
        if (event.stopReason === "error") {
          const errText =
            event.errorMessage ?? (text.length > 0 ? text : "The model returned no response.");
          messages = messages.map((m) =>
            m.id === sid
              ? {
                  ...mapMessageWithTextPart(m, () => textPart(errText)),
                  metadata: { ...m.metadata, errorKind: "unknown" },
                }
              : m,
          );
        } else if (text.length === 0) {
          messages = messages.filter((m) => m.id !== sid);
        } else {
          messages = messages.map((m) =>
            m.id === sid ? mapMessageWithTextPart(m, () => textPart(text)) : m,
          );
        }
        streamingMsgId = null;
        break;
      }
      case "turn_error": {
        const msg: OldChatMessage = {
          ...assistantTextMessage(event.reason),
          metadata: { errorKind: event.kind },
        };
        messages = [...messages, msg];
        break;
      }
      case "tool_execution_start": {
        const msg = assistantToolMessage(
          toolPartRunning(event.toolCallId, event.toolName, event.args),
        );
        toolMsgIds.set(event.toolCallId, msg.id);
        messages = [...messages, msg];
        break;
      }
      case "tool_execution_end": {
        const msgId = toolMsgIds.get(event.toolCallId);
        if (msgId === undefined) break;
        toolMsgIds.delete(event.toolCallId);
        messages = messages.map((m) => {
          if (m.id !== msgId) return m;
          const first = m.parts[0];
          if (!first || first.type !== "dynamic-tool") return m;
          const next = event.isError
            ? toolPartError(first.toolCallId, first.toolName, first.input, event.resultText)
            : toolPartDone(first.toolCallId, first.toolName, first.input, event.resultText);
          return replaceToolPart(m, next);
        });
        break;
      }
      case "agent_start":
      case "queue_update":
        break;
    }
    return messages;
  };
}

/** Verbatim pre-extraction history conversion (note: it DROPPED isError). */
function oldHistoryToChatMessages(history: readonly ChatHistoryEntry[]): OldChatMessage[] {
  let nextMsgId = 0;
  const out: OldChatMessage[] = [];
  for (const entry of history) {
    switch (entry.role) {
      case "user":
        out.push({
          id: `m_${nextMsgId++}`,
          role: "user",
          parts: [{ type: "text", text: stripNoteContext(entry.text) }],
        });
        break;
      case "assistant":
        out.push({
          id: `m_${nextMsgId++}`,
          role: "assistant",
          parts: [{ type: "text", text: entry.text }],
        });
        break;
      case "tool":
        break;
    }
  }
  return out;
}

// ---- comparison ------------------------------------------------------------

type IdlessMessage = Omit<OldChatMessage, "id">;

function stripIds(messages: readonly OldChatMessage[]): IdlessMessage[] {
  return messages.map((m) => ({
    role: m.role,
    parts: m.parts,
    ...(m.metadata !== undefined ? { metadata: m.metadata } : {}),
  }));
}

const noMeta: ReadonlyMap<string, ChatMessageMetadata> = new Map();

describe("desktop parity — shared fold + projection vs the old inline fold", () => {
  for (const fixture of chatEventFixtures) {
    it(`matches after every event: ${fixture.name}`, () => {
      const oldStep = makeOldFold();
      let log: ChatLog = emptyChatLog;
      fixture.events.forEach((event, i) => {
        const oldMessages = oldStep(event);
        log = applyAgentEvent(log, event);
        expect(stripIds(projectChatLog(log, noMeta)), `after event ${i} (${event.type})`).toEqual(
          stripIds(oldMessages),
        );
      });
    });
  }

  it("matches on history rehydration (no error entries)", () => {
    expect(stripIds(projectChatLog(logFromHistory(historyFixture), noMeta))).toEqual(
      stripIds(oldHistoryToChatMessages(historyFixture)),
    );
  });

  // KNOWN, INTENTIONAL divergence — the one place the two platform folds
  // disagreed: ChatHistoryEntry.isError. Mobile preserved it on rehydrate
  // (error styling survives a reload); the desktop inline fold silently
  // dropped it, so an errored turn reloaded as a normal bubble even though
  // the live path had just rendered it red. The shared fold unifies on
  // preserving it. This test pins the delta so the change is loud.
  it("DIVERGENCE PIN: rehydrated error turns now keep errorKind (old fold dropped it)", () => {
    const oldMessages = oldHistoryToChatMessages(historyWithErrorFixture);
    const newMessages = projectChatLog(logFromHistory(historyWithErrorFixture), noMeta);

    // Old behavior: the persisted error flag vanished.
    expect(oldMessages[1]?.metadata).toBeUndefined();
    // New behavior: it renders as a cause-unknown failure surface, matching
    // what the live turn showed and what mobile always did.
    expect(newMessages[1]?.metadata).toEqual({ errorKind: "unknown" });

    // Everything else about the rehydrated thread is identical.
    expect(stripIds(newMessages).map(dropMeta)).toEqual(stripIds(oldMessages).map(dropMeta));
  });
});

function dropMeta(m: IdlessMessage): Omit<IdlessMessage, "metadata"> {
  return { role: m.role, parts: m.parts };
}
