// ---------------------------------------------------------------------------
// Read persisted session history directly from disk — the live thread's
// rehydration (readSessionHistory) plus the READ-ONLY past-chat browser
// (listChatSessions / readChatSessionById). Listing and reading are the whole
// surface: there is deliberately NO open-a-past-session-as-the-active-thread
// path here — resume stays continueRecent-only (@repo/agent/agent).
// ---------------------------------------------------------------------------

import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import {
  SessionManager,
  type SessionEntry,
  type SessionMessageEntry,
  type ToolCall,
  type ToolResultMessage,
} from "@repo/agent/pi/pi-types";

import { SESSION_DIR, WORKSPACE_DIR } from "@repo/agent/paths";
import { extractTextFromContent, isRecord, toErrorMessage } from "@repo/bridge/wire-helpers";
import { stripNoteContext } from "@repo/bridge/note-context";
import type { ChatHistoryEntry } from "@repo/bridge/chat-log";
import type { ChatSessionSummary, ReadChatSessionResult } from "@repo/bridge/chat-sessions";

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
// Entry conversion (shared by the live-thread rehydration and the browser)
// ---------------------------------------------------------------------------

/** Convert raw session entries into the renderer's ChatHistoryEntry[] and cap
 * the final list at a user-message boundary (no orphaned tool/assistant
 * entries at the start). */
function entriesToChatHistory(entries: readonly SessionEntry[]): ChatHistoryEntry[] {
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
}

// ---------------------------------------------------------------------------
// Public API — the live thread
// ---------------------------------------------------------------------------

/**
 * Read the most recent session's messages from disk and convert to
 * ChatHistoryEntry[] for the renderer. Called once per renderer mount via
 * the AGENT_HISTORY IPC.
 */
export function readSessionHistory(): ChatHistoryEntry[] {
  try {
    const sm = SessionManager.continueRecent(WORKSPACE_DIR, SESSION_DIR);
    return entriesToChatHistory(sm.getEntries());
  } catch (err) {
    console.warn("[session-history] failed to read session:", err);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Public API — the read-only past-chat browser
// ---------------------------------------------------------------------------

const SESSION_TITLE_MAX = 80;

/** pi's SessionInfo.firstMessage sentinel when a session holds no user text. */
const PI_NO_MESSAGES = "(no messages)";

/** The listed shape of one on-disk session — the SessionInfo subset the
 * summary is computed from (pure, so the parsing is unit-testable). */
export type SessionListing = {
  id: string;
  modified: Date;
  messageCount: number;
  firstMessage: string;
};

/** A list row's title: the first user message with the auto-attached
 * `[Context: …]` prefix stripped, whitespace collapsed, truncated. */
export function sessionTitle(firstMessage: string): string {
  const stripped = stripNoteContext(firstMessage).replace(/\s+/g, " ").trim();
  if (stripped === "" || stripped === PI_NO_MESSAGES) return "(empty)";
  return stripped.length <= SESSION_TITLE_MAX
    ? stripped
    : `${stripped.slice(0, SESSION_TITLE_MAX - 1)}…`;
}

/** Pure projection of on-disk session listings into browser rows: drop the
 * ACTIVE thread (it's already the live chat) and message-less files, newest
 * first. */
export function summarizeSessions(
  listings: readonly SessionListing[],
  activeSessionId: string | null,
): ChatSessionSummary[] {
  return listings
    .filter((s) => s.id !== activeSessionId && s.messageCount > 0)
    .sort((a, b) => b.modified.getTime() - a.modified.getTime())
    .map((s) => ({
      id: s.id,
      title: sessionTitle(s.firstMessage),
      updatedAt: s.modified.getTime(),
      messageCount: s.messageCount,
    }));
}

/**
 * List past chat threads in SESSION_DIR, newest first. `activeSessionId`
 * (the live agent's session) is excluded — the browser shows PAST chats.
 * pi's list() reads only top-level *.jsonl, so the background/inline-ai
 * subdirectories never leak in.
 */
export async function listChatSessions(
  activeSessionId: string | null,
): Promise<ChatSessionSummary[]> {
  try {
    const infos = await SessionManager.list(WORKSPACE_DIR, SESSION_DIR);
    return summarizeSessions(infos, activeSessionId);
  } catch (err) {
    console.warn("[session-history] failed to list sessions:", err);
    return [];
  }
}

/** Mirrors pi's assertValidSessionId grammar — checked BEFORE the id touches
 * any directory scan so a malformed id is rejected as a value. */
const SESSION_ID_RE = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;

/**
 * Read ONE past session's transcript by id (same shape readSessionHistory
 * returns). Unknown/malformed ids come back as `{ ok: false }` values.
 * Strictly read-only: session files are matched by pi's `<timestamp>_<id>.jsonl`
 * naming against actual directory entries (the id is never joined into a
 * path), and empty files are refused rather than opened — SessionManager.open
 * would initialize an empty file with a fresh header.
 */
export function readChatSessionById(
  id: string,
  sessionDir: string = SESSION_DIR,
): ReadChatSessionResult {
  if (!SESSION_ID_RE.test(id)) return { ok: false, error: "Malformed session id" };

  let fileName: string | undefined;
  try {
    fileName = readdirSync(sessionDir).find((name) => name.endsWith(`_${id}.jsonl`));
  } catch {
    return { ok: false, error: `No session with id "${id}"` };
  }
  if (fileName === undefined) return { ok: false, error: `No session with id "${id}"` };

  try {
    const filePath = join(sessionDir, fileName);
    if (statSync(filePath).size === 0) {
      return { ok: false, error: `No session with id "${id}"` };
    }
    const sm = SessionManager.open(filePath);
    // The header id is authoritative — a renamed file must not impersonate.
    if (sm.getSessionId() !== id) {
      return { ok: false, error: `No session with id "${id}"` };
    }
    return { ok: true, entries: entriesToChatHistory(sm.getEntries()) };
  } catch (err) {
    return { ok: false, error: toErrorMessage(err) };
  }
}
