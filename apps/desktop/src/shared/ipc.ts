import type {
  InterruptResult,
  SendMessageResult,
  SteerResult,
} from "./agent";
import type { AppEvent, AppState } from "./app-state";
import type {
  CreateTaskParams,
  CreateTaskResult,
  DeleteTaskResult,
  ListTasksResult,
  ToggleTaskResult,
} from "./task";
import type { VoiceEvent, VoiceSettings, VoiceSettingsResponse } from "./voice";

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

  // App lifecycle
  APP_STATE: "app:state",
  APP_TRANSITION: "app:transition",
  APP_GET_STATE: "app:get-state",

  // Agent
  AGENT_SEND_MESSAGE: "agent:send-message",
  AGENT_STEER: "agent:steer",
  AGENT_INTERRUPT: "agent:interrupt",
  AGENT_CLEAR: "agent:clear",
  AGENT_EVENT: "agent:event",

  // Tasks
  TASK_CREATE: "task:create",
  TASK_LIST: "task:list",
  TASK_DELETE: "task:delete",
  TASK_TOGGLE: "task:toggle",

  // Voice
  VOICE_START: "voice:start",
  VOICE_STOP: "voice:stop",
  VOICE_AUDIO_CHUNK: "voice:audio-chunk",
  VOICE_EVENT: "voice:event",
  VOICE_GET_SETTINGS: "voice:get-settings",
  VOICE_SET_SETTINGS: "voice:set-settings",
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

  // App lifecycle
  getAppState: () => Promise<AppState>;
  transition: (event: AppEvent) => Promise<void>;
  onAppState: (listener: (state: AppState) => void) => () => void;

  // Agent
  sendMessage: (message: string) => Promise<SendMessageResult>;
  steer: (message: string) => Promise<SteerResult>;
  interrupt: () => Promise<InterruptResult>;
  clear: () => Promise<{ ok: true }>;
  onAgentEvent: (listener: (event: unknown) => void) => () => void;

  // Tasks
  createTask: (params: CreateTaskParams) => Promise<CreateTaskResult>;
  listTasks: () => Promise<ListTasksResult>;
  deleteTask: (id: string) => Promise<DeleteTaskResult>;
  toggleTask: (id: string) => Promise<ToggleTaskResult>;

  // Voice
  startVoice: () => Promise<{ ok: boolean; error?: string }>;
  stopVoice: () => Promise<{ ok: boolean }>;
  sendAudioChunk: (base64: string) => void;
  onVoiceEvent: (listener: (event: VoiceEvent) => void) => () => void;
  getVoiceSettings: () => Promise<VoiceSettingsResponse>;
  setVoiceSettings: (settings: VoiceSettings) => Promise<{ ok: boolean }>;
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

