// ---------------------------------------------------------------------------
// IPC public surface for renderer + main consumers. The channel-and-schema
// registry lives in ipc-registry.ts; this file is the renderer-facing
// re-export of the types that actually flow through it, plus a handful of
// adjacent helpers (Skills, Integrations, isRecord/isHttpUrl/extractText).
// Specialized payload types (executor, IPC registry internals) are imported
// directly from their owning modules.
// ---------------------------------------------------------------------------

export type {
  ChatHistoryEntry,
  DesktopBridge,
  ExecutorStatus,
  IntegrationInfo,
  NotificationSettings,
  SetupProgress,
  SkillInfo,
  UpdateState,
  VoiceModelStateEvent,
} from "./ipc-registry";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function isHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function extractText(message: unknown): string {
  if (!isRecord(message)) return "";
  if (!Array.isArray(message["content"])) return "";
  const parts: string[] = [];
  for (const block of message["content"]) {
    if (isRecord(block) && block["type"] === "text") {
      const text = block["text"];
      if (typeof text === "string") parts.push(text);
    }
  }
  return parts.join("");
}
