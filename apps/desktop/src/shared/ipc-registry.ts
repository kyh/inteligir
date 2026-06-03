// ---------------------------------------------------------------------------
// IPC registry — single source of truth for every channel that crosses the
// main <-> preload <-> renderer boundary. Each entry pairs a channel name
// with a Zod payload schema (for runtime validation) and a TypeScript
// result/event type (for compile-time inference). The DesktopBridge type
// and the preload bridge object are both derived from this registry, so a
// rename here is a compile error everywhere it matters.
// ---------------------------------------------------------------------------

import { z } from "zod";

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
import type {
  FloatRect,
  InstallWidgetInput,
  ShellSnapshot,
  WidgetDef,
  WidgetGeometry,
  WidgetInstance,
} from "./shell";
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

const UpdateStatusSchema = z.enum([
  "idle",
  "checking",
  "available",
  "not-available",
  "downloading",
  "downloaded",
  "error",
]);

export const UpdateStateSchema = z.object({
  status: UpdateStatusSchema,
  version: z.string().nullable(),
  downloadPercent: z.number().nullable(),
  message: z.string().nullable(),
});

export type UpdateState = z.infer<typeof UpdateStateSchema>;

export type UpdateResponse = {
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

const NotificationsPatchSchema = z.object({ enabled: z.boolean().optional() });

const PlaceWidgetSchema = z.object({
  widgetId: z.string(),
  surface: z.enum(["pinned", "floating"]).optional(),
});

const DeleteWidgetSchema = z.object({
  widgetId: z.string(),
  expectedRevision: z.number().optional(),
});

const WidgetGeometriesSchema: z.ZodType<Record<string, WidgetGeometry>> = z.record(
  z.string(),
  z.object({
    x: z.number(),
    y: z.number(),
    w: z.number(),
    h: z.number(),
    minW: z.number().optional(),
    minH: z.number().optional(),
  }),
);

const FloatRectSchema: z.ZodType<FloatRect> = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
});

const SetInstanceRectSchema = z.object({
  instanceId: z.string(),
  rect: FloatRectSchema,
});

const SetInstanceSurfaceSchema = z.object({
  instanceId: z.string(),
  surface: z.enum(["pinned", "floating"]),
});

const SetInstanceStateSchema = z.object({
  instanceId: z.string(),
  state: z.record(z.string(), z.unknown()),
});

const FlushAckSchema = z.object({
  requestId: z.string(),
  persisted: z.boolean(),
});

const WidgetPromptSchema = z.object({ prompt: z.string() });
const WidgetCompleteSchema = z.object({ prompt: z.string(), system: z.string().optional() });
const WidgetFetchSchema = z.object({ url: z.string() });
const WidgetCallToolSchema = z.object({ tool: z.string(), input: z.unknown().optional() });
const WidgetOpenUrlSchema = z.object({ url: z.string() });

// InstallWidgetInput carries a WidgetSpecInput whose Zod schema lives in
// widget-spec-schema.ts (collapsed in Wave D); parse there, accept as
// opaque-validated-elsewhere here.
const InstallWidgetInputSchema: z.ZodType<InstallWidgetInput> = z.custom<InstallWidgetInput>(
  (v) =>
    typeof v === "object" &&
    v !== null &&
    typeof (v as InstallWidgetInput).title === "string" &&
    typeof (v as InstallWidgetInput).spec === "object",
);

// ---------------------------------------------------------------------------
// Entry helpers — phantom types carry result/event shapes through the registry
// ---------------------------------------------------------------------------

type Invoke<P, R> = {
  readonly kind: "invoke";
  readonly channel: string;
  readonly payload: z.ZodType<P>;
  readonly _result: R;
};

type InvokeVoid<R> = {
  readonly kind: "invoke-void";
  readonly channel: string;
  readonly _result: R;
};

type Send<P> = {
  readonly kind: "send";
  readonly channel: string;
  readonly payload: z.ZodType<P>;
};

type Event<E> = {
  readonly kind: "event";
  readonly channel: string;
  readonly _event: E;
};

type IpcEntry =
  | Invoke<unknown, unknown>
  | InvokeVoid<unknown>
  | Send<unknown>
  | Event<unknown>;

const invoke = <P, R>(channel: string, payload: z.ZodType<P>): Invoke<P, R> => ({
  kind: "invoke",
  channel,
  payload,
  _result: undefined as never,
});
const invokeVoid = <R>(channel: string): InvokeVoid<R> => ({
  kind: "invoke-void",
  channel,
  _result: undefined as never,
});
const send = <P>(channel: string, payload: z.ZodType<P>): Send<P> => ({
  kind: "send",
  channel,
  payload,
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
  transition: invoke<z.infer<typeof AppEventSchema>, void>("app:transition", AppEventSchema),
  onAppState: event<AppState>("app:state"),
  onSetupProgress: event<SetupProgress>("app:setup-progress"),

  // Agent
  onAgentEvent: event<AppAgentEvent>("agent:event"),
  sendAgentCommand: invoke<z.infer<typeof TextChatMessageSchema>, void>(
    "agent:command",
    TextChatMessageSchema,
  ),
  getAgentHistory: invokeVoid<ChatHistoryEntry[]>("agent:history"),
  reauthenticate: invokeVoid<{ ok: boolean; error?: string }>("agent:reauthenticate"),

  // Tasks
  createTask: invoke<z.infer<typeof CreateTaskParamsSchema>, CreateTaskResult>(
    "task:create",
    CreateTaskParamsSchema,
  ),
  listTasks: invokeVoid<ListTasksResult>("task:list"),
  deleteTask: invoke<string, DeleteTaskResult>("task:delete", z.string().min(1)),
  toggleTask: invoke<string, ToggleTaskResult>("task:toggle", z.string().min(1)),

  // Voice
  isTtsAvailable: invokeVoid<boolean>("voice:tts:available"),
  ttsSend: send<{ text: string }>("voice:tts:send", z.object({ text: z.string() })),
  ttsFlush: send<undefined>("voice:tts:flush", z.undefined()),
  ttsInterrupt: send<undefined>("voice:tts:interrupt", z.undefined()),
  onTtsAudio: event<{ audio: ArrayBuffer }>("voice:tts:audio"),
  startStt: invokeVoid<{ ok: boolean; reason?: string }>("voice:stt:start"),
  sendSttAudio: send<ArrayBuffer | ArrayBufferView>(
    "voice:stt:audio",
    z.custom<ArrayBuffer | ArrayBufferView>(
      (v) => v instanceof ArrayBuffer || ArrayBuffer.isView(v),
    ),
  ),
  stopStt: invokeVoid<Array<{ text: string; isFinal: boolean }>>("voice:stt:stop"),
  onSttTranscript: event<{ text: string; isFinal: boolean }>("voice:stt:transcript"),
  getVoiceModelStatus: invokeVoid<"ready" | "missing">("voice:model:status"),
  downloadVoiceModel: invokeVoid<{ ok: boolean; error?: string }>("voice:model:download"),
  onVoiceModelState: event<VoiceModelStateEvent>("voice:model:state"),

  // Notifications
  getNotificationSettings: invokeVoid<NotificationSettings>("notifications:get"),
  updateNotificationSettings: invoke<
    z.infer<typeof NotificationsPatchSchema>,
    NotificationSettings
  >("notifications:update", NotificationsPatchSchema),

  // UI state
  getUiState: invokeVoid<Record<string, unknown>>("ui-state:get"),
  setUiState: invoke<z.infer<typeof UiStateSetSchema>, void>("ui-state:set", UiStateSetSchema),

  // Shell
  listShell: invokeVoid<ShellSnapshot>("shell:list"),
  onShellUpdated: event<ShellSnapshot>("shell:updated"),
  installWidget: invoke<InstallWidgetInput, WidgetDef>("shell:install", InstallWidgetInputSchema),
  placeWidget: invoke<z.infer<typeof PlaceWidgetSchema>, WidgetInstance | null>(
    "shell:place",
    PlaceWidgetSchema,
  ),
  unplaceWidget: invoke<string, { removed: boolean }>("shell:unplace", z.string()),
  deleteWidget: invoke<z.infer<typeof DeleteWidgetSchema>, { deleted: boolean }>(
    "shell:delete",
    DeleteWidgetSchema,
  ),
  setInstanceGeometry: invoke<Record<string, WidgetGeometry>, void>(
    "shell:set-geometry",
    WidgetGeometriesSchema,
  ),
  setInstanceRect: invoke<z.infer<typeof SetInstanceRectSchema>, void>(
    "shell:set-rect",
    SetInstanceRectSchema,
  ),
  setInstanceSurface: invoke<z.infer<typeof SetInstanceSurfaceSchema>, WidgetInstance | null>(
    "shell:set-surface",
    SetInstanceSurfaceSchema,
  ),
  focusInstance: invoke<string, void>("shell:focus", z.string()),
  setInstanceState: invoke<z.infer<typeof SetInstanceStateSchema>, WidgetInstance | null>(
    "shell:set-state",
    SetInstanceStateSchema,
  ),
  onWidgetFlushRequest: event<{ instanceId: string; requestId: string }>("shell:flush-request"),
  ackWidgetFlush: send<z.infer<typeof FlushAckSchema>>("shell:flush-ack", FlushAckSchema),

  // Live widget actions
  widgetSendPrompt: invoke<z.infer<typeof WidgetPromptSchema>, void>(
    "widget:send-prompt",
    WidgetPromptSchema,
  ),
  widgetComplete: invoke<z.infer<typeof WidgetCompleteSchema>, string>(
    "widget:complete",
    WidgetCompleteSchema,
  ),
  widgetFetch: invoke<z.infer<typeof WidgetFetchSchema>, string>("widget:fetch", WidgetFetchSchema),
  widgetCallTool: invoke<z.infer<typeof WidgetCallToolSchema>, unknown>(
    "widget:call-tool",
    WidgetCallToolSchema,
  ),
  widgetOpenUrl: invoke<z.infer<typeof WidgetOpenUrlSchema>, boolean>(
    "widget:open-url",
    WidgetOpenUrlSchema,
  ),

  // Executor
  executorStatus: invokeVoid<ExecutorStatus>("executor:status"),
  listExecutorSources: invokeVoid<z.infer<typeof ExecutorSourceSchema>[]>(
    "executor:sources:list",
  ),
  detectExecutorSource: invoke<string, z.infer<typeof ExecutorDetectResultSchema>[]>(
    "executor:sources:detect",
    z.string(),
  ),
  addMcpSource: invoke<z.infer<typeof AddMcpSourceInputSchema>, ExecutorAddSourceResult>(
    "executor:source:add-mcp",
    AddMcpSourceInputSchema,
  ),
  addOpenApiSource: invoke<z.infer<typeof AddOpenApiSourceInputSchema>, ExecutorAddSourceResult>(
    "executor:source:add-openapi",
    AddOpenApiSourceInputSchema,
  ),
  addGraphqlSource: invoke<z.infer<typeof AddGraphqlSourceInputSchema>, ExecutorAddSourceResult>(
    "executor:source:add-graphql",
    AddGraphqlSourceInputSchema,
  ),
  addGoogleSource: invoke<z.infer<typeof AddGoogleSourceInputSchema>, ExecutorAddSourceResult>(
    "executor:source:add-google",
    AddGoogleSourceInputSchema,
  ),
  removeExecutorSource: invoke<string, { removed: boolean }>(
    "executor:source:remove",
    z.string(),
  ),
  refreshExecutorSource: invoke<string, { refreshed: boolean }>(
    "executor:source:refresh",
    z.string(),
  ),
  listExecutorSecrets: invokeVoid<z.infer<typeof ExecutorSecretRefSchema>[]>(
    "executor:secrets:list",
  ),
  setExecutorSecret: invoke<z.infer<typeof SetSecretInputSchema>, z.infer<typeof ExecutorSecretRefSchema>>(
    "executor:secret:set",
    SetSecretInputSchema,
  ),
  removeExecutorSecret: invoke<string, { removed: boolean }>(
    "executor:secret:remove",
    z.string(),
  ),
  listExecutorConnections: invokeVoid<z.infer<typeof ExecutorConnectionRefSchema>[]>(
    "executor:connections:list",
  ),
  removeExecutorConnection: invoke<string, { removed: boolean }>(
    "executor:connection:remove",
    z.string(),
  ),
  executorOAuthStart: invoke<z.infer<typeof OAuthStartInputSchema>, z.infer<typeof OAuthStartResultSchema>>(
    "executor:oauth:start",
    OAuthStartInputSchema,
  ),
  executorOAuthAwait: invoke<string, z.infer<typeof OAuthAwaitResultSchema> | null>(
    "executor:oauth:await",
    z.string(),
  ),
  executorOpenExternal: invoke<string, void>("executor:open-external", z.string()),

  // Skills
  listSkills: invokeVoid<import("./ipc").SkillsList>("skills:list"),

  // Integrations
  listIntegrations: invokeVoid<import("./ipc").IntegrationInfo[]>("integrations:list"),
  repairIntegrations: invokeVoid<void>("integrations:repair"),
} as const satisfies Record<string, IpcEntry>;

export type IpcRegistry = typeof IPC;
export type IpcMethod = keyof IpcRegistry;

// ---------------------------------------------------------------------------
// Type derivations
// ---------------------------------------------------------------------------

type MethodToFn<E extends IpcEntry> =
  E extends Invoke<infer P, infer R>
    ? (payload: P) => Promise<R>
    : E extends InvokeVoid<infer R>
      ? () => Promise<R>
      : E extends Send<infer P>
        ? (payload: P) => void
        : E extends Event<infer V>
          ? (listener: (event: V) => void) => () => void
          : never;

/** The shape exposed on `window.desktopBridge`. Derived from the registry. */
export type DesktopBridge = {
  [K in IpcMethod]: MethodToFn<IpcRegistry[K]>;
};

/** Map a method name to the handler signature main implements. */
export type IpcHandler<K extends IpcMethod> =
  IpcRegistry[K] extends Invoke<infer P, infer R>
    ? (payload: P) => R | Promise<R>
    : IpcRegistry[K] extends InvokeVoid<infer R>
      ? () => R | Promise<R>
      : IpcRegistry[K] extends Send<infer P>
        ? (payload: P) => void
        : never;

/** Map a method name to its broadcast event payload. */
export type IpcEvent<K extends IpcMethod> =
  IpcRegistry[K] extends Event<infer V> ? V : never;
