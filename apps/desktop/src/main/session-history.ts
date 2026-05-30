// ---------------------------------------------------------------------------
// Read persisted session history directly from disk.
// ---------------------------------------------------------------------------

import {
  SessionManager,
  type Message,
  type SessionMessageEntry,
  type TextContent,
  type ToolCall,
  type ToolResultMessage,
} from "@repo/pi-driver";

import { inteligirPath } from "@/main/lib/json-store";
import { isRecord, type ChatHistoryEntry } from "@/shared/ipc";

const SESSION_DIR = inteligirPath("sessions");
const WORKSPACE_DIR = inteligirPath("workspace");

let cachedHistory: ChatHistoryEntry[] | undefined;

/** Clear the cached session history (e.g. on logout). */
export function clearSessionHistoryCache(): void {
  cachedHistory = undefined;
}

// ---------------------------------------------------------------------------
// Type guards for pi-ai content blocks
// ---------------------------------------------------------------------------

function isTextContent(block: unknown): block is TextContent {
  return (
    isRecord(block) &&
    block.type === "text" &&
    typeof block.text === "string"
  );
}

function isToolCall(block: unknown): block is ToolCall {
  return (
    isRecord(block) &&
    block.type === "toolCall" &&
    typeof block.id === "string" &&
    typeof block.name === "string"
  );
}

function isToolResult(msg: unknown): msg is ToolResultMessage {
  return (
    isRecord(msg) &&
    msg.role === "toolResult" &&
    typeof msg.toolCallId === "string"
  );
}

function isSessionMessageEntry(entry: unknown): entry is SessionMessageEntry {
  return isRecord(entry) && entry.type === "message" && "message" in entry;
}

function extractTextFromContent(content: Message["content"]): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter(isTextContent)
    .map((b) => b.text)
    .join("");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Read the most recent session's messages from disk and convert to
 * ChatHistoryEntry[] for the renderer.
 *
 * Called eagerly at startup (before initMachine), and again by the renderer
 * via IPC to get the cached result.
 */
export function readSessionHistory(): ChatHistoryEntry[] {
  if (cachedHistory !== undefined) return cachedHistory;
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
    if (history.length > MAX_UI_MESSAGES) {
      const originalStart = history.length - MAX_UI_MESSAGES;
      let start = originalStart;
      // Walk forward to the nearest user message so we don't cut mid-turn
      while (start < history.length && history[start]?.role !== "user") {
        start++;
      }
      // Fall back to the original position if no user message was found
      if (start >= history.length) start = originalStart;
      cachedHistory = history.slice(start);
    } else {
      cachedHistory = history;
    }
    return cachedHistory;
  } catch (err) {
    console.warn("[session-history] failed to read session:", err);
    // Don't cache on error — allow retry on the next IPC call
    return [];
  }
}
