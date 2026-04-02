// ---------------------------------------------------------------------------
// Read persisted session history directly from disk (no sidecar needed).
// ---------------------------------------------------------------------------

import {
  SessionManager,
  type SessionMessageEntry,
} from "@mariozechner/pi-coding-agent";
import type {
  Message,
  TextContent,
  ToolCall,
  ToolResultMessage,
} from "@mariozechner/pi-ai";

import { inteligirPath } from "@/main/lib/json-store";
import type { ChatHistoryEntry } from "@/shared/ipc";

const SESSION_DIR = inteligirPath("sessions");
const WORKSPACE_DIR = inteligirPath("workspace");

/**
 * Resolved session file path from the most recent call to readSessionHistory().
 * Used to ensure the sidecar opens the same session the UI loaded history from.
 */
let lastSessionFile: string | undefined;
let cachedHistory: ChatHistoryEntry[] | undefined;

/** Return the session file path resolved by the last readSessionHistory() call. */
export function getResolvedSessionFile(): string | undefined {
  return lastSessionFile;
}

/** Clear the cached session file path and history (e.g. on logout). */
export function clearResolvedSessionFile(): void {
  lastSessionFile = undefined;
  cachedHistory = undefined;
}

// ---------------------------------------------------------------------------
// Type guards for pi-ai content blocks
// ---------------------------------------------------------------------------

function isTextContent(block: unknown): block is TextContent {
  return (
    typeof block === "object" &&
    block !== null &&
    "type" in block &&
    (block as Record<string, unknown>).type === "text" &&
    "text" in block &&
    typeof (block as Record<string, unknown>).text === "string"
  );
}

function isToolCall(block: unknown): block is ToolCall {
  return (
    typeof block === "object" &&
    block !== null &&
    "type" in block &&
    (block as Record<string, unknown>).type === "toolCall" &&
    "id" in block &&
    "name" in block
  );
}

function isToolResult(msg: unknown): msg is ToolResultMessage {
  return (
    typeof msg === "object" &&
    msg !== null &&
    "role" in msg &&
    (msg as Record<string, unknown>).role === "toolResult" &&
    "toolCallId" in msg
  );
}

function extractTextFromContent(content: Message["content"]): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter(isTextContent).map((b) => b.text).join("");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Read the most recent session's messages from disk and convert to
 * ChatHistoryEntry[] for the renderer.
 *
 * Called eagerly at startup (before initMachine) to resolve the session file
 * path, and again by the renderer via IPC to get the cached result.
 */
/**
 * Eagerly load session history during startup (before initMachine).
 * Populates lastSessionFile so the sidecar receives the correct path.
 */
export function preloadSessionHistory(): void {
  readSessionHistory();
}

export function readSessionHistory(): ChatHistoryEntry[] {
  if (cachedHistory !== undefined) return cachedHistory;
  try {
    const sm = SessionManager.continueRecent(WORKSPACE_DIR, SESSION_DIR);
    lastSessionFile = sm.getSessionFile();
    const entries = sm.getEntries();
    const history: ChatHistoryEntry[] = [];

    for (const entry of entries) {
      if (entry.type !== "message") continue;
      const msg = (entry as SessionMessageEntry).message;
      if (!msg || typeof msg !== "object" || !("role" in msg)) continue;

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

    // Cap the final UI message list (not raw entries) since one entry can
    // expand into multiple ChatHistoryEntry items (e.g. tool calls).
    const MAX_UI_MESSAGES = 200;
    cachedHistory = history.length > MAX_UI_MESSAGES
      ? history.slice(-MAX_UI_MESSAGES)
      : history;
    return cachedHistory;
  } catch (err) {
    console.warn("[session-history] failed to read session:", err);
    cachedHistory = [];
    return cachedHistory;
  }
}
