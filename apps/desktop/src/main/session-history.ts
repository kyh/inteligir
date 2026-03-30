// ---------------------------------------------------------------------------
// Read persisted session history directly from disk (no sidecar needed).
// ---------------------------------------------------------------------------

import { SessionManager } from "@mariozechner/pi-coding-agent";

import { inteligirPath } from "@/main/lib/json-store";
import type { ChatHistoryEntry } from "@/shared/ipc";

const SESSION_DIR = inteligirPath("sessions");
const WORKSPACE_DIR = inteligirPath("workspace");

/**
 * Read the most recent session's messages from disk and convert to
 * ChatHistoryEntry[] for the renderer.
 */
export function readSessionHistory(): ChatHistoryEntry[] {
  try {
    const sm = SessionManager.continueRecent(WORKSPACE_DIR, SESSION_DIR);
    const entries = sm.getEntries();
    const history: ChatHistoryEntry[] = [];

    for (const entry of entries) {
      if (entry.type !== "message") continue;
      const msg = entry.message;
      if (!msg || typeof msg !== "object" || !("role" in msg)) continue;

      if (msg.role === "user") {
        const text = typeof msg.content === "string"
          ? msg.content
          : Array.isArray(msg.content)
            ? msg.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("")
            : "";
        if (text) history.push({ role: "user", text });
      } else if (msg.role === "assistant") {
        const textParts = Array.isArray(msg.content)
          ? msg.content.filter((b: any) => b.type === "text").map((b: any) => b.text)
          : [];
        const text = textParts.join("");
        if (text) history.push({ role: "assistant", text });

        // Extract tool calls
        if (Array.isArray(msg.content)) {
          for (const block of msg.content) {
            if (block && typeof block === "object" && "type" in block && block.type === "toolCall") {
              const tc = block as { id: string; name: string };
              history.push({ role: "tool", text: "", toolName: tc.name, toolCallId: tc.id });
            }
          }
        }
      } else if (msg.role === "toolResult") {
        const resultText = Array.isArray(msg.content)
          ? msg.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("")
          : "";
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

    return history;
  } catch (err) {
    console.warn("[session-history] failed to read session:", err);
    return [];
  }
}
