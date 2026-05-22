import type { AppAgentEvent } from "./agent-events";
import type { AppEvent, AppState } from "./app-state";
import type { DispatchState } from "./dispatch";
import type {
  CreateTaskParams,
  CreateTaskResult,
  DeleteTaskResult,
  ListTasksResult,
  ToggleTaskResult,
} from "./task";
import type { TextChatMessage } from "./voice";

// ---------------------------------------------------------------------------
// IPC channel names shared between Electron main <-> preload <-> renderer
// ---------------------------------------------------------------------------

export const IPC_CHANNELS = {
  // Desktop
  OPEN_EXTERNAL: "desktop:open-external",
  UPDATE_STATE: "desktop:update-state",
  UPDATE_CHECK: "desktop:update-check",
  UPDATE_DOWNLOAD: "desktop:update-download",
  UPDATE_INSTALL: "desktop:update-install",

  // App lifecycle
  APP_STATE: "app:state",
  APP_TRANSITION: "app:transition",
  APP_GET_STATE: "app:get-state",
  SETUP_PROGRESS: "app:setup-progress",

  // Agent
  AGENT_EVENT: "agent:event",
  AGENT_COMMAND: "agent:command",
  AGENT_HISTORY: "agent:history",

  // Tasks
  TASK_CREATE: "task:create",
  TASK_LIST: "task:list",
  TASK_DELETE: "task:delete",
  TASK_TOGGLE: "task:toggle",

  // Voice
  VOICE_CONFIG: "voice:config",

  // Dispatch (mobile ↔ desktop relay)
  DISPATCH_STATE: "dispatch:state",
  DISPATCH_GET_STATE: "dispatch:get-state",
  DISPATCH_REFRESH_CODE: "dispatch:refresh-code",

  // Notifications
  NOTIFICATIONS_GET: "notifications:get",
  NOTIFICATIONS_UPDATE: "notifications:update",

  // Extensions / tools (#7 dock)
  EXTENSIONS_LIST: "extensions:list",
  EXTENSIONS_SET_ACTIVE: "extensions:set-active",
} as const;

// ---------------------------------------------------------------------------
// Update state
// ---------------------------------------------------------------------------

export type UpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "not-available"
  | "downloading"
  | "downloaded"
  | "error";

export type UpdateState = {
  status: UpdateStatus;
  version: string | null;
  downloadPercent: number | null;
  message: string | null;
};

export type UpdateResponse = {
  accepted: boolean;
  state: UpdateState;
};

// ---------------------------------------------------------------------------
// Setup progress (onboarding download/install)
// ---------------------------------------------------------------------------

/**
 * Progress event emitted while seedResources runs bundle setups. `percent` is
 * null when a step has no measurable progress (e.g. a binary download with
 * unknown total). `null` after `step === "done"` signals completion.
 */
export type SetupProgress = {
  step: string;
  percent: number | null;
};

// ---------------------------------------------------------------------------
// Desktop bridge (preload -> renderer)
// ---------------------------------------------------------------------------

export type ChatHistoryEntry = {
  role: "user" | "assistant" | "tool";
  text: string;
  toolName?: string;
  toolCallId?: string;
  isError?: boolean;
};

export type DesktopBridge = {
  // Desktop
  openExternal: (url: string) => Promise<boolean>;
  checkForUpdates: () => Promise<UpdateState>;
  downloadUpdate: () => Promise<UpdateResponse>;
  installUpdate: () => Promise<UpdateResponse>;
  onUpdateState: (listener: (state: UpdateState) => void) => () => void;

  // App lifecycle
  getAppState: () => Promise<AppState>;
  transition: (event: AppEvent) => Promise<void>;
  onAppState: (listener: (state: AppState) => void) => () => void;
  onSetupProgress: (listener: (progress: SetupProgress) => void) => () => void;

  // Agent
  onAgentEvent: (listener: (event: AppAgentEvent) => void) => () => void;
  sendAgentCommand: (command: TextChatMessage) => Promise<void>;
  getAgentHistory: () => Promise<ChatHistoryEntry[]>;

  // Tasks
  createTask: (params: CreateTaskParams) => Promise<CreateTaskResult>;
  listTasks: () => Promise<ListTasksResult>;
  deleteTask: (id: string) => Promise<DeleteTaskResult>;
  toggleTask: (id: string) => Promise<ToggleTaskResult>;

  // Voice
  getVoiceConfig: () => Promise<{
    deepgramApiKey: string;
    elevenlabsApiKey: string;
    elevenlabsVoiceId?: string;
  } | null>;

  // Dispatch (mobile ↔ desktop relay)
  getDispatchState: () => Promise<DispatchState>;
  refreshDispatchCode: () => Promise<void>;
  onDispatchState: (listener: (state: DispatchState) => void) => () => void;

  // Notifications
  getNotificationSettings: () => Promise<NotificationSettings>;
  updateNotificationSettings: (
    patch: Partial<NotificationSettings>,
  ) => Promise<NotificationSettings>;

  // Extensions / tools
  listExtensions: () => Promise<ExtensionsList>;
  setActiveExtensions: (toolNames: string[]) => Promise<ExtensionsList>;
};

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export type NotificationSettings = {
  enabled: boolean;
};

// ---------------------------------------------------------------------------
// Extensions (#7) — projection of pi-coding-agent's tool registry for the dock
// ---------------------------------------------------------------------------

import type { PiAgentTool } from "@repo/pi-driver";

export type ExtensionToolInfo = PiAgentTool;

export type ExtensionsList = {
  tools: ExtensionToolInfo[];
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

// ---------------------------------------------------------------------------
// pi-ai content block helpers (shared between main & renderer)
// ---------------------------------------------------------------------------

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
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
