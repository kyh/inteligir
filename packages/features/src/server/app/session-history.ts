// ---------------------------------------------------------------------------
// Read persisted session history directly from disk.
// ---------------------------------------------------------------------------

import {
  SessionManager,
  type SessionMessageEntry,
  type ToolCall,
  type ToolResultMessage,
} from "@repo/features/server/pi/pi-types";

import { SESSION_DIR, WORKSPACE_DIR } from "../agent/paths";
import { extractTextFromContent, isRecord } from "@repo/features/wire-helpers";
import type { ChatHistoryEntry } from "@repo/features/chat-log";

// ---------------------------------------------------------------------------
// Type guards for pi-ai content blocks
// ---------------------------------------------------------------------------

function isToolCall(block: unknown): block is ToolCall {
  return (
    isRecord(block) &&
    block.type === "toolCall" &&
    typeof block.id === "string" &&
    typeof block.name === "string"
  );
}

function isToolResult(msg: unknown): msg is ToolResultMessage {
  return isRecord(msg) && msg.role === "toolResult" && typeof msg.toolCallId === "string";
}

function isSessionMessageEntry(entry: unknown): entry is SessionMessageEntry {
  return isRecord(entry) && entry.type === "message" && "message" in entry;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Read the most recent session's messages from disk and convert to
 * ChatHistoryEntry[] for the renderer. Called once per renderer mount via
 * the AGENT_HISTORY IPC.
 */
export function readSessionHistory(): ChatHistoryEntry[] {
  try {
    const sm = SessionManager.continueRecent(WORKSPACE_DIR, SESSION_DIR);
    const entries = sm.getEntries();
    const history: ChatHistoryEntry[] = [];

    for (const entry of entries) {
      if (!isSessionMessageEntry(entry)) continue;
      const msg = entry.message;
      if (!isRecord(msg) || !("role" in msg)) continue;

      if (msg.role === "user") {
        const text = extractTextFromContent(msg.content);
        if (text) history.push({ role: "user", text });
      } else if (msg.role === "assistant") {
        const text = extractTextFromContent(msg.content);
        if (text) history.push({ role: "assistant", text });

        // Extract tool calls
        if (Array.isArray(msg.content)) {
          for (const block of msg.content) {
            if (isToolCall(block)) {
              history.push({ role: "tool", text: "", toolName: block.name, toolCallId: block.id });
            }
          }
        }
      } else if (isToolResult(msg)) {
        const resultText = extractTextFromContent(msg.content);
        // Update the matching tool entry
        for (let i = history.length - 1; i >= 0; i--) {
          const h = history[i];
          if (h && h.role === "tool" && h.toolCallId === msg.toolCallId) {
            h.text = resultText;
            h.isError = msg.isError;
            break;
          }
        }
      }
    }

    // Cap the final UI message list. Slice at a user-message boundary to
    // avoid orphaned tool/assistant entries at the start.
    const MAX_UI_MESSAGES = 200;
    if (history.length <= MAX_UI_MESSAGES) return history;
    const originalStart = history.length - MAX_UI_MESSAGES;
    let start = originalStart;
    while (start < history.length && history[start]?.role !== "user") {
      start++;
    }
    if (start >= history.length) start = originalStart;
    return history.slice(start);
  } catch (err) {
    console.warn("[session-history] failed to read session:", err);
    return [];
  }
}
