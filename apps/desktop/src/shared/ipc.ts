import type {
  GetStateResult,
  InterruptResult,
  SendMessageResult,
  SteerResult,
} from "./agent";
import type {
  GetSettingsResult,
  LoginResult,
  LogoutResult,
  SetSettingsParams,
  SetSettingsResult,
} from "./settings";
import type {
  CreateTaskParams,
  CreateTaskResult,
  DeleteTaskResult,
  ListTasksResult,
  ToggleTaskResult,
} from "./task";

// ---------------------------------------------------------------------------
// IPC channel names shared between Electron main <-> preload <-> renderer
// ---------------------------------------------------------------------------

export const MENU_ACTIONS = {
  OPEN_SETTINGS: "open-settings",
} as const;

export const IPC_CHANNELS = {
  // Desktop
  OPEN_EXTERNAL: "desktop:open-external",
  MENU_ACTION: "desktop:menu-action",
  UPDATE_STATE: "desktop:update-state",
  UPDATE_CHECK: "desktop:update-check",
  UPDATE_DOWNLOAD: "desktop:update-download",
  UPDATE_INSTALL: "desktop:update-install",

  // Agent
  AGENT_SEND_MESSAGE: "agent:send-message",
  AGENT_STEER: "agent:steer",
  AGENT_INTERRUPT: "agent:interrupt",
  AGENT_GET_STATE: "agent:get-state",
  AGENT_GET_MESSAGES: "agent:get-messages",
  AGENT_CLEAR: "agent:clear",
  AGENT_EVENT: "agent:event",

  // Auth
  AUTH_LOGIN: "auth:login",
  AUTH_LOGOUT: "auth:logout",

  // Settings
  SETTINGS_GET: "settings:get",
  SETTINGS_SET: "settings:set",

  // Tasks
  TASK_CREATE: "task:create",
  TASK_LIST: "task:list",
  TASK_DELETE: "task:delete",
  TASK_TOGGLE: "task:toggle",

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
// Desktop bridge (preload -> renderer)
// ---------------------------------------------------------------------------

export type DesktopBridge = {
  // Desktop
  openExternal: (url: string) => Promise<boolean>;
  onMenuAction: (listener: (action: string) => void) => () => void;
  checkForUpdates: () => Promise<UpdateState>;
  downloadUpdate: () => Promise<UpdateResponse>;
  installUpdate: () => Promise<UpdateResponse>;
  onUpdateState: (listener: (state: UpdateState) => void) => () => void;

  // Agent
  sendMessage: (message: string) => Promise<SendMessageResult>;
  steer: (message: string) => Promise<SteerResult>;
  interrupt: () => Promise<InterruptResult>;
  getAgentState: () => Promise<GetStateResult>;
  getMessages: () => Promise<{ entries: ConversationEntry[] }>;
  clear: () => Promise<{ ok: true }>;
  onAgentEvent: (listener: (event: unknown) => void) => () => void;

  // Auth
  login: () => Promise<LoginResult>;
  logout: () => Promise<LogoutResult>;

  // Settings
  getSettings: () => Promise<GetSettingsResult>;
  setSettings: (settings: SetSettingsParams) => Promise<SetSettingsResult>;

  // Tasks
  createTask: (params: CreateTaskParams) => Promise<CreateTaskResult>;
  listTasks: () => Promise<ListTasksResult>;
  deleteTask: (id: string) => Promise<DeleteTaskResult>;
  toggleTask: (id: string) => Promise<ToggleTaskResult>;

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

export function extractText(message: unknown): string {
  if (typeof message !== "object" || message === null) return "";
  const msg = message as Record<string, unknown>;
  if (!Array.isArray(msg["content"])) return "";
  const parts: string[] = [];
  for (const block of msg["content"] as unknown[]) {
    if (
      typeof block === "object" &&
      block !== null &&
      (block as Record<string, unknown>)["type"] === "text"
    ) {
      const text = (block as Record<string, unknown>)["text"];
      if (typeof text === "string") parts.push(text);
    }
  }
  return parts.join("");
}

export function extractRole(message: unknown): string {
  if (typeof message === "object" && message !== null && "role" in message) {
    const role = (message as Record<string, unknown>).role;
    if (typeof role === "string") return role;
  }
  return "assistant";
}

// Re-export for convenience
import type { ConversationEntry } from "./conversation";
export type { ConversationEntry };
