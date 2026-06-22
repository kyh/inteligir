// ---------------------------------------------------------------------------
// IPC registry — single source of truth for every channel that crosses the
// main <-> preload <-> renderer boundary. Each entry pairs a channel name
// with a TypeBox payload schema (for runtime validation) and a TypeScript
// result/event type (for compile-time inference). The DesktopBridge type
// and the preload bridge object are both derived from this registry, so a
// rename here is a compile error everywhere it matters.
// ---------------------------------------------------------------------------

import { type Static, type TSchema, Type } from "@sinclair/typebox";

import type { PiAgentSkill } from "@repo/pi-driver/skills";

import type { AppAgentEvent } from "./agent-events";
import { AppEventSchema, type AppState } from "./app-state";
import {
  AddGraphqlInputSchema,
  AddMcpInputSchema,
  AddOpenApiInputSchema,
  ConnectionKeyInputSchema,
  CreateConnectionInputSchema,
  CreateOAuthClientInputSchema,
  ExecutorConnectionSchema,
  ExecutorDetectResultSchema,
  ExecutorIntegrationSchema,
  ExecutorOAuthClientSchema,
  OAuthAwaitResultSchema,
  OAuthProbeResultSchema,
  OAuthStartInputSchema,
  OAuthStartResultSchema,
  RegisterDynamicOAuthClientInputSchema,
  type AddGraphqlResult,
  type AddMcpResult,
  type AddOpenApiResult,
} from "./executor";
import {
  FloatRectSchema,
  WidgetGeometrySchema,
  type ShellSnapshot,
  type WidgetDef,
  type WidgetInstance,
} from "./shell";
import {
  CreateTaskParamsSchema,
  type CreateTaskResult,
  type DeleteTaskResult,
  type ListTasksResult,
  type ToggleTaskResult,
} from "./task";
import {
  CreateTodoParamsSchema,
  UpdateTodoParamsSchema,
  type ClearCompletedTodosResult,
  type CreateTodoResult,
  type DeleteTodoResult,
  type ListTodosResult,
  type TodoSyncResult,
  type ToggleTodoResult,
  type UpdateTodoResult,
} from "./todo";
import { UiStateSetSchema } from "./ui-state";
import { TextChatMessageSchema } from "./voice";
import type { DispatchState } from "./dispatch";

// ---------------------------------------------------------------------------
// Shared shapes referenced by registry entries
// ---------------------------------------------------------------------------

const UpdateStatusSchema = Type.Union([
  Type.Literal("idle"),
  Type.Literal("checking"),
  Type.Literal("available"),
  Type.Literal("not-available"),
  Type.Literal("downloading"),
  Type.Literal("downloaded"),
  Type.Literal("error"),
]);

const UpdateStateSchema = Type.Object(
  {
    status: UpdateStatusSchema,
    version: Type.Union([Type.String(), Type.Null()]),
    downloadPercent: Type.Union([Type.Number(), Type.Null()]),
    message: Type.Union([Type.String(), Type.Null()]),
  },
  { additionalProperties: false },
);

export type UpdateState = Static<typeof UpdateStateSchema>;

type UpdateResponse = {
  accepted: boolean;
  state: UpdateState;
};

export type VoiceModelStateEvent =
  | { status: "idle" }
  | { status: "downloading"; percent: number; receivedBytes: number; totalBytes: number }
  | { status: "extracting" }
  | { status: "ready" }
  | { status: "error"; message: string };

export type SetupProgress = {
  step: string;
  percent: number | null;
};

export type ChatHistoryEntry = {
  role: "user" | "assistant" | "tool";
  text: string;
  toolName?: string;
  toolCallId?: string;
  isError?: boolean;
};

export type ExecutorStatus =
  | { running: false }
  // redirectUri is the daemon's browser-facing OAuth callback — surfaced so
  // the Google client dialog can show the exact URI to whitelist in GCP.
  | { running: true; redirectUri: string };

/** Result of ensureGoogleOAuthClient: "ready" means the shared "google"
 * client exists in executor (pre-registered, or just seeded from the
 * build's bundled credentials) and consent can start; "unavailable" means
 * neither — the renderer falls back to the paste-your-own-GCP-app dialog. */
export type EnsureGoogleClientResult =
  | { status: "ready"; source: "existing" | "bundled" }
  | { status: "unavailable" };

export type NotificationSettings = {
  enabled: boolean;
};

/** Installed-vs-pinned version of a CLI binary an extension installs. */
export type IntegrationInfo = {
  name: string;
  /** Version the app pins / ships. */
  expected: string;
  /** Version currently installed on disk, or null if missing/unreadable. */
  installed: string | null;
};

export type SkillInfo = PiAgentSkill;

export type SkillsList = {
  skills: SkillInfo[];
};

const NotificationsPatchSchema = Type.Object(
  { enabled: Type.Optional(Type.Boolean()) },
  { additionalProperties: false },
);

const PlaceWidgetSchema = Type.Object(
  {
    widgetId: Type.String(),
    surface: Type.Optional(Type.Union([Type.Literal("pinned"), Type.Literal("floating")])),
  },
  { additionalProperties: false },
);

const DeleteWidgetSchema = Type.Object(
  {
    widgetId: Type.String(),
    expectedRevision: Type.Optional(Type.Number()),
  },
  { additionalProperties: false },
);

const WidgetGeometriesSchema = Type.Record(Type.String(), WidgetGeometrySchema);

const SetInstanceRectSchema = Type.Object(
  { instanceId: Type.String(), rect: FloatRectSchema },
  { additionalProperties: false },
);

const SetInstanceSurfaceSchema = Type.Object(
  {
    instanceId: Type.String(),
    surface: Type.Union([Type.Literal("pinned"), Type.Literal("floating")]),
  },
  { additionalProperties: false },
);

const SetInstanceStateSchema = Type.Object(
  {
    instanceId: Type.String(),
    state: Type.Record(Type.String(), Type.Unknown()),
  },
  { additionalProperties: false },
);

const FlushAckSchema = Type.Object(
  { requestId: Type.String(), persisted: Type.Boolean() },
  { additionalProperties: false },
);

const WidgetPromptSchema = Type.Object({ prompt: Type.String() }, { additionalProperties: false });
const WidgetCompleteSchema = Type.Object(
  { prompt: Type.String(), system: Type.Optional(Type.String()) },
  { additionalProperties: false },
);
const WidgetFetchSchema = Type.Object({ url: Type.String() }, { additionalProperties: false });
const WidgetCallToolSchema = Type.Object(
  { tool: Type.String(), input: Type.Optional(Type.Unknown()) },
  { additionalProperties: false },
);

// Result envelope for widget:call-tool. The handler returns this instead of
// throwing so a failed tool call never reaches the renderer as Electron's
// "Error invoking remote method '…': <main-side stack>" string — which a widget
// would otherwise render verbatim into its error state. `ok:false` carries a
// short, already-cleaned message safe to show inline.
export type WidgetCallToolResult = { ok: true; data: unknown } | { ok: false; error: string };
const WidgetOpenUrlSchema = Type.Object({ url: Type.String() }, { additionalProperties: false });

// InstallWidgetInput carries a WidgetSpec — the deep validation lives in
// widget-spec.ts (TypeBox + cycle check). At the IPC boundary we only need
// to confirm the wrapper shape so a malformed payload rejects cleanly.
const InstallWidgetInputSchema = Type.Object(
  {
    id: Type.Optional(Type.String()),
    title: Type.String(),
    description: Type.Optional(Type.String()),
    spec: Type.Unknown(),
  },
  { additionalProperties: false },
);

// Float32Array / ArrayBuffer / ArrayBufferView don't have a TypeBox primitive;
// approximate with Type.Any plus a runtime instanceof guard at the handler.
const BinaryAudioSchema = Type.Any();

const TtsSendSchema = Type.Object({ text: Type.String() }, { additionalProperties: false });

const SetRemoteAccessSchema = Type.Object(
  { enabled: Type.Boolean() },
  { additionalProperties: false },
);

// ---------------------------------------------------------------------------
// Entry helpers — phantom types carry result/event shapes through the registry
// ---------------------------------------------------------------------------

// The `_payload`/`_result`/`_event` fields are phantom: optional and never
// set at runtime, they exist purely so `infer` can pull the wire types back
// out of an entry (see DesktopBridge / IpcResult below).
type Invoke<S extends TSchema, R> = {
  readonly kind: "invoke";
  readonly channel: string;
  readonly payload: S;
  readonly _payload?: Static<S>;
  readonly _result?: R;
};

type InvokeVoid<R> = {
  readonly kind: "invoke-void";
  readonly channel: string;
  readonly _result?: R;
};

type Send<S extends TSchema> = {
  readonly kind: "send";
  readonly channel: string;
  readonly payload: S;
  readonly _payload?: Static<S>;
};

type Event<E> = {
  readonly kind: "event";
  readonly channel: string;
  readonly _event?: E;
};

type IpcEntry = Invoke<TSchema, unknown> | InvokeVoid<unknown> | Send<TSchema> | Event<unknown>;

const invoke = <S extends TSchema, R>(channel: string, payload: S): Invoke<S, R> => ({
  kind: "invoke",
  channel,
  payload,
});
const invokeVoid = <R>(channel: string): InvokeVoid<R> => ({
  kind: "invoke-void",
  channel,
});
const send = <S extends TSchema>(channel: string, payload: S): Send<S> => ({
  kind: "send",
  channel,
  payload,
});
const event = <E>(channel: string): Event<E> => ({
  kind: "event",
  channel,
});

// ---------------------------------------------------------------------------
// The registry — every method that crosses the IPC boundary
// ---------------------------------------------------------------------------

export const IPC = {
  // Desktop / updates
  checkForUpdates: invokeVoid<UpdateState>("desktop:update-check"),
  downloadUpdate: invokeVoid<UpdateResponse>("desktop:update-download"),
  installUpdate: invokeVoid<UpdateResponse>("desktop:update-install"),
  onUpdateState: event<UpdateState>("desktop:update-state"),

  // App lifecycle
  getAppState: invokeVoid<AppState>("app:get-state"),
  transition: invoke<typeof AppEventSchema, void>("app:transition", AppEventSchema),
  onAppState: event<AppState>("app:state"),
  onSetupProgress: event<SetupProgress>("app:setup-progress"),

  // Agent
  onAgentEvent: event<AppAgentEvent>("agent:event"),
  sendAgentCommand: invoke<typeof TextChatMessageSchema, void>(
    "agent:command",
    TextChatMessageSchema,
  ),
  getAgentHistory: invokeVoid<ChatHistoryEntry[]>("agent:history"),
  reauthenticate: invokeVoid<{ ok: boolean; error?: string }>("agent:reauthenticate"),

  // Tasks
  createTask: invoke<typeof CreateTaskParamsSchema, CreateTaskResult>(
    "task:create",
    CreateTaskParamsSchema,
  ),
  listTasks: invokeVoid<ListTasksResult>("task:list"),
  deleteTask: invoke<ReturnType<typeof Type.String>, DeleteTaskResult>(
    "task:delete",
    Type.String({ minLength: 1 }),
  ),
  toggleTask: invoke<ReturnType<typeof Type.String>, ToggleTaskResult>(
    "task:toggle",
    Type.String({ minLength: 1 }),
  ),
  /** Push channel: fired on every task mutation (IPC, agent tool, scheduler)
   * so the Tasks panel stays live instead of only refreshing on mount. */
  onTasksUpdated: event<ListTasksResult>("task:updated"),

  // To-dos
  createTodo: invoke<typeof CreateTodoParamsSchema, CreateTodoResult>(
    "todo:create",
    CreateTodoParamsSchema,
  ),
  listTodos: invokeVoid<ListTodosResult>("todo:list"),
  updateTodo: invoke<typeof UpdateTodoParamsSchema, UpdateTodoResult>(
    "todo:update",
    UpdateTodoParamsSchema,
  ),
  toggleTodo: invoke<ReturnType<typeof Type.String>, ToggleTodoResult>(
    "todo:toggle",
    Type.String({ minLength: 1 }),
  ),
  deleteTodo: invoke<ReturnType<typeof Type.String>, DeleteTodoResult>(
    "todo:delete",
    Type.String({ minLength: 1 }),
  ),
  clearCompletedTodos: invokeVoid<ClearCompletedTodosResult>("todo:clearCompleted"),
  /** Two-way sync with Google Tasks. Resolves to a result envelope (never
   * rejects for an unconnected connector) so the panel shows a clean message. */
  syncTodos: invokeVoid<TodoSyncResult>("todo:sync"),
  /** Push channel: fired on every todo mutation (IPC, agent tool, or sync) so
   * the To-Do panel stays live without a remount. */
  onTodosUpdated: event<ListTodosResult>("todo:updated"),

  // Voice
  isTtsAvailable: invokeVoid<boolean>("voice:tts:available"),
  ttsSend: send<typeof TtsSendSchema>("voice:tts:send", TtsSendSchema),
  ttsFlush: send<ReturnType<typeof Type.Undefined>>("voice:tts:flush", Type.Undefined()),
  ttsInterrupt: send<ReturnType<typeof Type.Undefined>>("voice:tts:interrupt", Type.Undefined()),
  onTtsAudio: event<{ audio: ArrayBuffer }>("voice:tts:audio"),
  startStt: invokeVoid<{ ok: boolean; reason?: string }>("voice:stt:start"),
  // ArrayBuffer / ArrayBufferView can't be expressed in TypeBox; pass through.
  sendSttAudio: send<typeof BinaryAudioSchema>("voice:stt:audio", BinaryAudioSchema),
  stopStt: invokeVoid<Array<{ text: string; isFinal: boolean }>>("voice:stt:stop"),
  onSttTranscript: event<{ text: string; isFinal: boolean }>("voice:stt:transcript"),
  getVoiceModelStatus: invokeVoid<"ready" | "missing">("voice:model:status"),
  downloadVoiceModel: invokeVoid<{ ok: boolean; error?: string }>("voice:model:download"),
  onVoiceModelState: event<VoiceModelStateEvent>("voice:model:state"),

  // Dispatch (Remote Access relay — opt-in mobile ↔ desktop pairing)
  getDispatchState: invokeVoid<DispatchState>("dispatch:get-state"),
  setRemoteAccess: invoke<typeof SetRemoteAccessSchema, DispatchState>(
    "dispatch:set-remote-access",
    SetRemoteAccessSchema,
  ),
  rotateDispatchCredential: invokeVoid<DispatchState>("dispatch:rotate-credential"),
  onDispatchState: event<DispatchState>("dispatch:state"),

  // Notifications
  getNotificationSettings: invokeVoid<NotificationSettings>("notifications:get"),
  updateNotificationSettings: invoke<typeof NotificationsPatchSchema, NotificationSettings>(
    "notifications:update",
    NotificationsPatchSchema,
  ),

  // UI state
  getUiState: invokeVoid<Record<string, unknown>>("ui-state:get"),
  setUiState: invoke<typeof UiStateSetSchema, void>("ui-state:set", UiStateSetSchema),

  // Shell
  listShell: invokeVoid<ShellSnapshot>("shell:list"),
  onShellUpdated: event<ShellSnapshot>("shell:updated"),
  installWidget: invoke<typeof InstallWidgetInputSchema, WidgetDef>(
    "shell:install",
    InstallWidgetInputSchema,
  ),
  placeWidget: invoke<typeof PlaceWidgetSchema, WidgetInstance | null>(
    "shell:place",
    PlaceWidgetSchema,
  ),
  unplaceWidget: invoke<ReturnType<typeof Type.String>, { removed: boolean }>(
    "shell:unplace",
    Type.String(),
  ),
  deleteWidget: invoke<typeof DeleteWidgetSchema, { deleted: boolean }>(
    "shell:delete",
    DeleteWidgetSchema,
  ),
  setInstanceGeometry: invoke<typeof WidgetGeometriesSchema, void>(
    "shell:set-geometry",
    WidgetGeometriesSchema,
  ),
  setInstanceRect: invoke<typeof SetInstanceRectSchema, void>(
    "shell:set-rect",
    SetInstanceRectSchema,
  ),
  setInstanceSurface: invoke<typeof SetInstanceSurfaceSchema, WidgetInstance | null>(
    "shell:set-surface",
    SetInstanceSurfaceSchema,
  ),
  focusInstance: invoke<ReturnType<typeof Type.String>, void>("shell:focus", Type.String()),
  setInstanceState: invoke<typeof SetInstanceStateSchema, WidgetInstance | null>(
    "shell:set-state",
    SetInstanceStateSchema,
  ),
  onWidgetFlushRequest: event<{ instanceId: string; requestId: string }>("shell:flush-request"),
  ackWidgetFlush: send<typeof FlushAckSchema>("shell:flush-ack", FlushAckSchema),

  // Live widget actions
  widgetSendPrompt: invoke<typeof WidgetPromptSchema, void>(
    "widget:send-prompt",
    WidgetPromptSchema,
  ),
  widgetComplete: invoke<typeof WidgetCompleteSchema, string>(
    "widget:complete",
    WidgetCompleteSchema,
  ),
  widgetFetch: invoke<typeof WidgetFetchSchema, string>("widget:fetch", WidgetFetchSchema),
  widgetCallTool: invoke<typeof WidgetCallToolSchema, WidgetCallToolResult>(
    "widget:call-tool",
    WidgetCallToolSchema,
  ),
  widgetOpenUrl: invoke<typeof WidgetOpenUrlSchema, boolean>(
    "widget:open-url",
    WidgetOpenUrlSchema,
  ),

  // Executor (v1.5 model: integrations = catalog, connections = credentials).
  // The v1 sources/secrets channels are gone — secrets are now connection
  // credential values; Google goes through add-openapi (googleDiscoveryBundle).
  executorStatus: invokeVoid<ExecutorStatus>("executor:status"),
  listExecutorIntegrations: invokeVoid<Static<typeof ExecutorIntegrationSchema>[]>(
    "executor:integrations:list",
  ),
  detectExecutorIntegration: invoke<
    ReturnType<typeof Type.String>,
    Static<typeof ExecutorDetectResultSchema>[]
  >("executor:integrations:detect", Type.String()),
  addMcpIntegration: invoke<typeof AddMcpInputSchema, AddMcpResult>(
    "executor:integration:add-mcp",
    AddMcpInputSchema,
  ),
  addOpenApiIntegration: invoke<typeof AddOpenApiInputSchema, AddOpenApiResult>(
    "executor:integration:add-openapi",
    AddOpenApiInputSchema,
  ),
  addGraphqlIntegration: invoke<typeof AddGraphqlInputSchema, AddGraphqlResult>(
    "executor:integration:add-graphql",
    AddGraphqlInputSchema,
  ),
  removeExecutorIntegration: invoke<ReturnType<typeof Type.String>, { removed: boolean }>(
    "executor:integration:remove",
    Type.String(),
  ),
  listExecutorConnections: invokeVoid<Static<typeof ExecutorConnectionSchema>[]>(
    "executor:connections:list",
  ),
  createExecutorConnection: invoke<
    typeof CreateConnectionInputSchema,
    Static<typeof ExecutorConnectionSchema>
  >("executor:connection:create", CreateConnectionInputSchema),
  removeExecutorConnection: invoke<typeof ConnectionKeyInputSchema, { removed: boolean }>(
    "executor:connection:remove",
    ConnectionKeyInputSchema,
  ),
  listExecutorOAuthClients: invokeVoid<Static<typeof ExecutorOAuthClientSchema>[]>(
    "executor:oauth:clients:list",
  ),
  createExecutorOAuthClient: invoke<typeof CreateOAuthClientInputSchema, { client: string }>(
    "executor:oauth:client:create",
    CreateOAuthClientInputSchema,
  ),
  ensureGoogleOAuthClient: invokeVoid<EnsureGoogleClientResult>(
    "executor:oauth:google-client:ensure",
  ),
  registerExecutorOAuthClientDynamic: invoke<
    typeof RegisterDynamicOAuthClientInputSchema,
    { client: string }
  >("executor:oauth:client:register-dynamic", RegisterDynamicOAuthClientInputSchema),
  executorOAuthProbe: invoke<ReturnType<typeof Type.String>, Static<typeof OAuthProbeResultSchema>>(
    "executor:oauth:probe",
    Type.String(),
  ),
  executorOAuthStart: invoke<typeof OAuthStartInputSchema, Static<typeof OAuthStartResultSchema>>(
    "executor:oauth:start",
    OAuthStartInputSchema,
  ),
  executorOAuthAwait: invoke<
    ReturnType<typeof Type.String>,
    Static<typeof OAuthAwaitResultSchema> | null
  >("executor:oauth:await", Type.String()),
  executorOpenExternal: invoke<ReturnType<typeof Type.String>, void>(
    "executor:open-external",
    Type.String(),
  ),

  // Skills
  listSkills: invokeVoid<SkillsList>("skills:list"),

  // Integrations
  listIntegrations: invokeVoid<IntegrationInfo[]>("integrations:list"),
  repairIntegrations: invokeVoid<void>("integrations:repair"),
} as const satisfies Record<string, IpcEntry>;

type IpcRegistry = typeof IPC;
export type IpcMethod = keyof IpcRegistry;

// ---------------------------------------------------------------------------
// Type derivations
// ---------------------------------------------------------------------------

type MethodToFn<E extends IpcEntry> =
  E extends Invoke<TSchema, infer R>
    ? (payload: E extends Invoke<infer S, infer _> ? Static<S> : never) => Promise<R>
    : E extends InvokeVoid<infer R>
      ? () => Promise<R>
      : E extends Send<TSchema>
        ? (payload: E extends Send<infer S> ? Static<S> : never) => void
        : E extends Event<infer V>
          ? (listener: (event: V) => void) => () => void
          : never;

/** The shape exposed on `window.desktopBridge`. Derived from the registry. */
export type DesktopBridge = {
  [K in IpcMethod]: MethodToFn<IpcRegistry[K]>;
};

/** Map a method name to the handler signature main implements. */
export type IpcHandler<K extends IpcMethod> =
  IpcRegistry[K] extends Invoke<infer S, infer R>
    ? (payload: Static<S>) => R | Promise<R>
    : IpcRegistry[K] extends InvokeVoid<infer R>
      ? () => R | Promise<R>
      : IpcRegistry[K] extends Send<infer S>
        ? (payload: Static<S>) => void
        : never;

/** Map a method name to its broadcast event payload. */
export type IpcEvent<K extends IpcMethod> = IpcRegistry[K] extends Event<infer V> ? V : never;
