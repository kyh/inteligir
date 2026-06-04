// ---------------------------------------------------------------------------
// IPC registry — single source of truth for every channel that crosses the
// main <-> preload <-> renderer boundary. Each entry pairs a channel name
// with a TypeBox payload schema (for runtime validation) and a TypeScript
// result/event type (for compile-time inference). The DesktopBridge type
// and the preload bridge object are both derived from this registry, so a
// rename here is a compile error everywhere it matters.
// ---------------------------------------------------------------------------

import { type Static, type TSchema, Type } from "@sinclair/typebox";

import type { AppAgentEvent } from "./agent-events";
import { AppEventSchema, type AppState } from "./app-state";
import {
  AddGoogleSourceInputSchema,
  AddGraphqlSourceInputSchema,
  AddMcpSourceInputSchema,
  AddOpenApiSourceInputSchema,
  ExecutorConnectionRefSchema,
  ExecutorDetectResultSchema,
  ExecutorSecretRefSchema,
  ExecutorSourceSchema,
  OAuthAwaitResultSchema,
  OAuthStartInputSchema,
  OAuthStartResultSchema,
  SetSecretInputSchema,
  type ExecutorAddSourceResult,
} from "./executor";
import type { ShellSnapshot, WidgetDef, WidgetInstance } from "./shell";
import {
  CreateTaskParamsSchema,
  type CreateTaskResult,
  type DeleteTaskResult,
  type ListTasksResult,
  type ToggleTaskResult,
} from "./task";
import { UiStateSetSchema } from "./ui-state";
import { TextChatMessageSchema } from "./voice";

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
  | { running: true; scope: { id: string; name: string; dir: string } };

export type NotificationSettings = {
  enabled: boolean;
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

const GeometrySchema = Type.Object(
  {
    x: Type.Number(),
    y: Type.Number(),
    w: Type.Number(),
    h: Type.Number(),
    minW: Type.Optional(Type.Number()),
    minH: Type.Optional(Type.Number()),
  },
  { additionalProperties: false },
);
const WidgetGeometriesSchema = Type.Record(Type.String(), GeometrySchema);

const FloatRectSchema = Type.Object(
  {
    x: Type.Number(),
    y: Type.Number(),
    width: Type.Number(),
    height: Type.Number(),
  },
  { additionalProperties: false },
);

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
export type WidgetCallToolResult =
  | { ok: true; data: unknown }
  | { ok: false; error: string };
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

// ---------------------------------------------------------------------------
// Entry helpers — phantom types carry result/event shapes through the registry
// ---------------------------------------------------------------------------

type Invoke<S extends TSchema, R> = {
  readonly kind: "invoke";
  readonly channel: string;
  readonly payload: S;
  readonly _payload: Static<S>;
  readonly _result: R;
};

type InvokeVoid<R> = {
  readonly kind: "invoke-void";
  readonly channel: string;
  readonly _result: R;
};

type Send<S extends TSchema> = {
  readonly kind: "send";
  readonly channel: string;
  readonly payload: S;
  readonly _payload: Static<S>;
};

type Event<E> = {
  readonly kind: "event";
  readonly channel: string;
  readonly _event: E;
};

type IpcEntry =
  | Invoke<TSchema, unknown>
  | InvokeVoid<unknown>
  | Send<TSchema>
  | Event<unknown>;

const invoke = <S extends TSchema, R>(channel: string, payload: S): Invoke<S, R> => ({
  kind: "invoke",
  channel,
  payload,
  _payload: undefined as never,
  _result: undefined as never,
});
const invokeVoid = <R>(channel: string): InvokeVoid<R> => ({
  kind: "invoke-void",
  channel,
  _result: undefined as never,
});
const send = <S extends TSchema>(channel: string, payload: S): Send<S> => ({
  kind: "send",
  channel,
  payload,
  _payload: undefined as never,
});
const event = <E>(channel: string): Event<E> => ({
  kind: "event",
  channel,
  _event: undefined as never,
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

  // Executor
  executorStatus: invokeVoid<ExecutorStatus>("executor:status"),
  listExecutorSources: invokeVoid<Static<typeof ExecutorSourceSchema>[]>("executor:sources:list"),
  detectExecutorSource: invoke<ReturnType<typeof Type.String>, Static<typeof ExecutorDetectResultSchema>[]>(
    "executor:sources:detect",
    Type.String(),
  ),
  addMcpSource: invoke<typeof AddMcpSourceInputSchema, ExecutorAddSourceResult>(
    "executor:source:add-mcp",
    AddMcpSourceInputSchema,
  ),
  addOpenApiSource: invoke<typeof AddOpenApiSourceInputSchema, ExecutorAddSourceResult>(
    "executor:source:add-openapi",
    AddOpenApiSourceInputSchema,
  ),
  addGraphqlSource: invoke<typeof AddGraphqlSourceInputSchema, ExecutorAddSourceResult>(
    "executor:source:add-graphql",
    AddGraphqlSourceInputSchema,
  ),
  addGoogleSource: invoke<typeof AddGoogleSourceInputSchema, ExecutorAddSourceResult>(
    "executor:source:add-google",
    AddGoogleSourceInputSchema,
  ),
  removeExecutorSource: invoke<ReturnType<typeof Type.String>, { removed: boolean }>(
    "executor:source:remove",
    Type.String(),
  ),
  refreshExecutorSource: invoke<ReturnType<typeof Type.String>, { refreshed: boolean }>(
    "executor:source:refresh",
    Type.String(),
  ),
  listExecutorSecrets: invokeVoid<Static<typeof ExecutorSecretRefSchema>[]>(
    "executor:secrets:list",
  ),
  setExecutorSecret: invoke<typeof SetSecretInputSchema, Static<typeof ExecutorSecretRefSchema>>(
    "executor:secret:set",
    SetSecretInputSchema,
  ),
  removeExecutorSecret: invoke<ReturnType<typeof Type.String>, { removed: boolean }>(
    "executor:secret:remove",
    Type.String(),
  ),
  listExecutorConnections: invokeVoid<Static<typeof ExecutorConnectionRefSchema>[]>(
    "executor:connections:list",
  ),
  removeExecutorConnection: invoke<ReturnType<typeof Type.String>, { removed: boolean }>(
    "executor:connection:remove",
    Type.String(),
  ),
  executorOAuthStart: invoke<typeof OAuthStartInputSchema, Static<typeof OAuthStartResultSchema>>(
    "executor:oauth:start",
    OAuthStartInputSchema,
  ),
  executorOAuthAwait: invoke<ReturnType<typeof Type.String>, Static<typeof OAuthAwaitResultSchema> | null>(
    "executor:oauth:await",
    Type.String(),
  ),
  executorOpenExternal: invoke<ReturnType<typeof Type.String>, void>(
    "executor:open-external",
    Type.String(),
  ),

  // Skills
  listSkills: invokeVoid<import("./ipc").SkillsList>("skills:list"),

  // Integrations
  listIntegrations: invokeVoid<import("./ipc").IntegrationInfo[]>("integrations:list"),
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
export type IpcEvent<K extends IpcMethod> =
  IpcRegistry[K] extends Event<infer V> ? V : never;
