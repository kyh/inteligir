import type { AppAgentEvent } from "./agent-events";
import type { AppEvent, AppState } from "./app-state";
import type {
  FloatRect,
  InstallWidgetInput,
  ShellSnapshot,
  WidgetDef,
  WidgetGeometry,
  WidgetInstance,
  WidgetSurface,
} from "./shell";
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
  AGENT_REAUTHENTICATE: "agent:reauthenticate",

  // Tasks
  TASK_CREATE: "task:create",
  TASK_LIST: "task:list",
  TASK_DELETE: "task:delete",
  TASK_TOGGLE: "task:toggle",

  // Voice
  VOICE_CONFIG: "voice:config",
  VOICE_STT_START: "voice:stt:start",
  VOICE_STT_AUDIO: "voice:stt:audio",
  VOICE_STT_STOP: "voice:stt:stop",
  VOICE_STT_TRANSCRIPT: "voice:stt:transcript",
  VOICE_MODEL_STATUS: "voice:model:status",
  VOICE_MODEL_DOWNLOAD: "voice:model:download",
  VOICE_MODEL_STATE: "voice:model:state",

  // Notifications
  NOTIFICATIONS_GET: "notifications:get",
  NOTIFICATIONS_UPDATE: "notifications:update",

  // UI state (persisted panel layout / view preferences)
  UI_STATE_GET: "ui-state:get",
  UI_STATE_SET: "ui-state:set",

  // Shell — the OS-like workspace (widget definitions + placed instances)
  SHELL_LIST: "shell:list",
  SHELL_UPDATED: "shell:updated",
  SHELL_INSTALL: "shell:install",
  SHELL_PLACE: "shell:place",
  SHELL_UNPLACE: "shell:unplace",
  SHELL_DELETE: "shell:delete",
  SHELL_SET_GEOMETRY: "shell:set-geometry",
  SHELL_SET_RECT: "shell:set-rect",
  SHELL_SET_SURFACE: "shell:set-surface",
  SHELL_FOCUS: "shell:focus",
  SHELL_SET_STATE: "shell:set-state",
  // Round-trip so a main-side action (e.g. agent unplace) can wait for the
  // renderer's debounced widget state to flush before transitioning the
  // instance. Request is broadcast; renderer replies with the matching id.
  SHELL_FLUSH_REQUEST: "shell:flush-request",
  SHELL_FLUSH_ACK: "shell:flush-ack",

  // Live widget actions
  WIDGET_SEND_PROMPT: "widget:send-prompt",
  WIDGET_COMPLETE: "widget:complete",
  WIDGET_FETCH: "widget:fetch",
  WIDGET_CALL_TOOL: "widget:call-tool",
  WIDGET_OPEN_URL: "widget:open-url",

  // Executor (integration backend) — wraps the executor daemon's HTTP API
  EXECUTOR_STATUS: "executor:status",
  EXECUTOR_SOURCES_LIST: "executor:sources:list",
  EXECUTOR_SOURCES_DETECT: "executor:sources:detect",
  EXECUTOR_SOURCE_ADD_MCP: "executor:source:add-mcp",
  EXECUTOR_SOURCE_ADD_OPENAPI: "executor:source:add-openapi",
  EXECUTOR_SOURCE_ADD_GRAPHQL: "executor:source:add-graphql",
  EXECUTOR_SOURCE_ADD_GOOGLE: "executor:source:add-google",
  EXECUTOR_SOURCE_REMOVE: "executor:source:remove",
  EXECUTOR_SOURCE_REFRESH: "executor:source:refresh",
  EXECUTOR_SECRETS_LIST: "executor:secrets:list",
  EXECUTOR_SECRET_SET: "executor:secret:set",
  EXECUTOR_SECRET_REMOVE: "executor:secret:remove",
  EXECUTOR_CONNECTIONS_LIST: "executor:connections:list",
  EXECUTOR_CONNECTION_REMOVE: "executor:connection:remove",
  EXECUTOR_OAUTH_START: "executor:oauth:start",
  EXECUTOR_OAUTH_AWAIT: "executor:oauth:await",
  EXECUTOR_OPEN_EXTERNAL: "executor:open-external",

  // Skills
  SKILLS_LIST: "skills:list",

  // Integrations (installed CLI binaries) — list versions + repair/reinstall
  INTEGRATIONS_LIST: "integrations:list",
  INTEGRATIONS_REPAIR: "integrations:repair",
} as const;

// ---------------------------------------------------------------------------
// Update state
// ---------------------------------------------------------------------------

type UpdateStatus =
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

type UpdateResponse = {
  accepted: boolean;
  state: UpdateState;
};

// ---------------------------------------------------------------------------
// Voice model (Parakeet STT) download lifecycle
// ---------------------------------------------------------------------------

export type VoiceModelStateEvent =
  | { status: "idle" }
  | { status: "downloading"; percent: number; receivedBytes: number; totalBytes: number }
  | { status: "extracting" }
  | { status: "ready" }
  | { status: "error"; message: string };

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
  /** Re-run the OAuth flow against the active provider and restart the
   * session so the next turn uses fresh credentials. */
  reauthenticate: () => Promise<{ ok: boolean; error?: string }>;

  // Tasks
  createTask: (params: CreateTaskParams) => Promise<CreateTaskResult>;
  listTasks: () => Promise<ListTasksResult>;
  deleteTask: (id: string) => Promise<DeleteTaskResult>;
  toggleTask: (id: string) => Promise<ToggleTaskResult>;

  // Voice
  getVoiceConfig: () => Promise<{
    elevenlabsApiKey: string;
    elevenlabsVoiceId?: string;
  } | null>;
  startStt: () => Promise<{ ok: boolean; reason?: string }>;
  sendSttAudio: (samples: Float32Array) => void;
  stopStt: () => Promise<Array<{ text: string; isFinal: boolean }>>;
  onSttTranscript: (listener: (event: { text: string; isFinal: boolean }) => void) => () => void;
  getVoiceModelStatus: () => Promise<"ready" | "missing">;
  downloadVoiceModel: () => Promise<{ ok: boolean; error?: string }>;
  onVoiceModelState: (listener: (event: VoiceModelStateEvent) => void) => () => void;

  // Notifications
  getNotificationSettings: () => Promise<NotificationSettings>;
  updateNotificationSettings: (
    patch: Partial<NotificationSettings>,
  ) => Promise<NotificationSettings>;

  // UI state
  getUiState: () => Promise<Record<string, unknown>>;
  setUiState: (key: string, value: unknown) => Promise<void>;

  // Shell — the OS-like workspace
  listShell: () => Promise<ShellSnapshot>;
  onShellUpdated: (listener: (next: ShellSnapshot) => void) => () => void;
  installWidget: (input: InstallWidgetInput) => Promise<WidgetDef>;
  placeWidget: (widgetId: string, surface?: WidgetSurface) => Promise<WidgetInstance | null>;
  unplaceWidget: (instanceId: string) => Promise<{ removed: boolean }>;
  deleteWidget: (widgetId: string, expectedRevision?: number) => Promise<{ deleted: boolean }>;
  setInstanceGeometry: (geometries: Record<string, WidgetGeometry>) => Promise<void>;
  setInstanceRect: (instanceId: string, rect: FloatRect) => Promise<void>;
  setInstanceSurface: (
    instanceId: string,
    surface: WidgetSurface,
  ) => Promise<WidgetInstance | null>;
  focusInstance: (instanceId: string) => Promise<void>;
  setInstanceState: (
    instanceId: string,
    state: Record<string, unknown>,
  ) => Promise<WidgetInstance | null>;
  onWidgetFlushRequest: (
    listener: (payload: { instanceId: string; requestId: string }) => void,
  ) => () => void;
  ackWidgetFlush: (requestId: string, persisted: boolean) => void;

  // Live widget actions
  widgetSendPrompt: (prompt: string) => Promise<void>;
  widgetComplete: (prompt: string, system?: string) => Promise<string>;
  widgetFetch: (url: string) => Promise<string>;
  widgetCallTool: (tool: string, input?: unknown) => Promise<unknown>;
  widgetOpenUrl: (url: string) => Promise<boolean>;

  // Executor (integration backend)
  executorStatus: () => Promise<ExecutorStatus>;
  listExecutorSources: () => Promise<ExecutorSource[]>;
  detectExecutorSource: (url: string) => Promise<ExecutorDetectResult[]>;
  addMcpSource: (input: AddMcpSourceInput) => Promise<ExecutorAddSourceResult>;
  addOpenApiSource: (input: AddOpenApiSourceInput) => Promise<ExecutorAddSourceResult>;
  addGraphqlSource: (input: AddGraphqlSourceInput) => Promise<ExecutorAddSourceResult>;
  addGoogleSource: (input: AddGoogleSourceInput) => Promise<ExecutorAddSourceResult>;
  removeExecutorSource: (sourceId: string) => Promise<{ removed: boolean }>;
  refreshExecutorSource: (sourceId: string) => Promise<{ refreshed: boolean }>;
  listExecutorSecrets: () => Promise<ExecutorSecretRef[]>;
  setExecutorSecret: (input: SetSecretInput) => Promise<ExecutorSecretRef>;
  removeExecutorSecret: (secretId: string) => Promise<{ removed: boolean }>;
  listExecutorConnections: () => Promise<ExecutorConnectionRef[]>;
  removeExecutorConnection: (connectionId: string) => Promise<{ removed: boolean }>;
  executorOAuthStart: (input: OAuthStartInput) => Promise<OAuthStartResult>;
  executorOAuthAwait: (sessionId: string) => Promise<OAuthAwaitResult | null>;
  executorOpenExternal: (url: string) => Promise<void>;

  // Skills
  listSkills: () => Promise<SkillsList>;

  // Integrations
  listIntegrations: () => Promise<IntegrationInfo[]>;
  repairIntegrations: () => Promise<void>;
};

/** Installed-vs-pinned version of a CLI binary an extension installs. */
export type IntegrationInfo = {
  name: string;
  /** Version the app pins / ships. */
  expected: string;
  /** Version currently installed on disk, or null if missing/unreadable. */
  installed: string | null;
};

/** Whether the executor daemon is running, and the active scope when it is. */
export type ExecutorStatus =
  | { running: false }
  | { running: true; scope: { id: string; name: string; dir: string } };

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export type NotificationSettings = {
  enabled: boolean;
};

// ---------------------------------------------------------------------------
// Executor (integration backend) — shared types
// ---------------------------------------------------------------------------

import type { PiAgentSkill } from "@repo/pi-driver/skills";

import type {
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

// ---------------------------------------------------------------------------
// Skills — SKILL.md capability docs pi discovers under the user (~/.inteligir/
// skills) and project (<workspace>/.pi/skills) scopes
// ---------------------------------------------------------------------------

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
