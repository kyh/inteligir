// ---------------------------------------------------------------------------
// IPC public surface for renderer + main consumers. The channel-and-schema
// registry now lives in ipc-registry.ts; this file keeps a handful of
// peripheral types and helpers (Skills, Integrations, executor types,
// helpers) close to the renderer's existing import paths.
// ---------------------------------------------------------------------------

import type { PiAgentSkill } from "@repo/pi-driver/skills";

export type {
  AddGoogleSourceInput,
  AddGraphqlSourceInput,
  AddMcpSourceInput,
  AddOpenApiSourceInput,
  ExecutorAddSourceResult,
  ExecutorConnectionRef,
  ExecutorDetectResult,
  ExecutorSecretRef,
  ExecutorSource,
  OAuthAwaitResult,
  OAuthStartInput,
  OAuthStartResult,
  SetSecretInput,
} from "./executor";

export type {
  ChatHistoryEntry,
  DesktopBridge,
  ExecutorStatus,
  NotificationSettings,
  SetupProgress,
  UpdateResponse,
  UpdateState,
  VoiceModelStateEvent,
} from "./ipc-registry";

export { IPC, type IpcMethod, type IpcHandler, type IpcEvent } from "./ipc-registry";

/** Installed-vs-pinned version of a CLI binary an extension installs. */
export type IntegrationInfo = {
  name: string;
  /** Version the app pins / ships. */
  expected: string;
  /** Version currently installed on disk, or null if missing/unreadable. */
  installed: string | null;
};

/**
 * Progress event emitted while seedResources runs bundle setups. `percent` is
 * null when a step has no measurable progress (e.g. a binary download with
 * unknown total). `null` after `step === "done"` signals completion.
 */
export type SkillInfo = PiAgentSkill;

export type SkillsList = {
  skills: SkillInfo[];
};

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
