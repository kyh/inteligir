// ---------------------------------------------------------------------------
// IPC registry — single source of truth for every channel that crosses the
// main <-> preload <-> renderer boundary. Each entry pairs a channel name
// with a TypeBox payload schema (for runtime validation) and a TypeScript
// result/event type (for compile-time inference). The Bridge type
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
  CreateDelegationParamsSchema,
  type CreateDelegationResult,
  type ListDelegationsResult,
} from "./delegation";
import { AiGenerateParamsSchema, type AiGenerateResult } from "./inline-ai";
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

// ---------------------------------------------------------------------------
// Vault — the user's local knowledge folder (markdown). Paths are
// vault-relative; main confines them under the vault root.
// ---------------------------------------------------------------------------

const VaultPathSchema = Type.Object({ path: Type.String() }, { additionalProperties: false });
const VaultWriteDocSchema = Type.Object(
  { path: Type.String(), content: Type.String() },
  { additionalProperties: false },
);

/** One file in the vault, relative to the vault root. `kind` splits editable
 * markdown docs (md/markdown/txt) from everything else (images, pdfs, …). */
export type VaultEntry = {
  path: string;
  name: string;
  kind: "doc" | "other";
};

export type ChooseVaultResult = { root: string } | { canceled: true } | { error: string };

const VaultRenameSchema = Type.Object(
  { from: Type.String(), to: Type.String() },
  { additionalProperties: false },
);

// Float32Array / ArrayBuffer / ArrayBufferView don't have a TypeBox primitive;
// approximate with Type.Any plus a runtime instanceof guard at the handler.
const BinaryAudioSchema = Type.Any();

const TtsSendSchema = Type.Object({ text: Type.String() }, { additionalProperties: false });

// ---------------------------------------------------------------------------
// Entry helpers — phantom types carry result/event shapes through the registry
// ---------------------------------------------------------------------------

// The `_payload`/`_result`/`_event` fields are phantom: optional and never
// set at runtime, they exist purely so `infer` can pull the wire types back
// out of an entry (see Bridge / IpcResult below).
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

  // Vault (knowledge folder) — trusted renderer surface for the editor.
  getVaultRoot: invokeVoid<string>("vault:get-root"),
  chooseVaultRoot: invokeVoid<ChooseVaultResult>("vault:choose-root"),
  listVault: invokeVoid<VaultEntry[]>("vault:list"),
  readVaultDoc: invoke<typeof VaultPathSchema, string>("vault:read-doc", VaultPathSchema),
  writeVaultDoc: invoke<typeof VaultWriteDocSchema, void>("vault:write-doc", VaultWriteDocSchema),
  deleteVaultEntry: invoke<typeof VaultPathSchema, { removed: boolean }>(
    "vault:delete",
    VaultPathSchema,
  ),
  /** Rename/move a file to a new vault-relative path (creating parent dirs).
   * Refuses to clobber an existing file. */
  renameVaultEntry: invoke<typeof VaultRenameSchema, { ok: true } | { ok: false; error: string }>(
    "vault:rename",
    VaultRenameSchema,
  ),
  /** Fired on every vault change (file edit by anyone, or a root switch) so the
   * sidebar re-lists and the editor reloads. */
  onVaultChanged: event<{ root: string }>("vault:changed"),

  // Delegation — a checkbox handed to a background agent.
  createDelegation: invoke<typeof CreateDelegationParamsSchema, CreateDelegationResult>(
    "delegation:create",
    CreateDelegationParamsSchema,
  ),
  listDelegations: invokeVoid<ListDelegationsResult>("delegation:list"),
  cancelDelegation: invoke<ReturnType<typeof Type.String>, { ok: boolean }>(
    "delegation:cancel",
    Type.String({ minLength: 1 }),
  ),
  /** Fired on every delegation status change so the editor's inline badges
   * stay live. */
  onDelegationsUpdated: event<ListDelegationsResult>("delegation:updated"),
  /** Fired as a running delegation streams its response text (accumulating,
   * keyed by id) so the response dock can show it live. */
  onDelegationStreamed: event<{ id: string; text: string }>("delegation:streamed"),

  // Inline AI — one-shot text generation for the editor (continue / summarize /
  // improve), run on an isolated no-tools session.
  generateInlineAi: invoke<typeof AiGenerateParamsSchema, AiGenerateResult>(
    "ai:generate",
    AiGenerateParamsSchema,
  ),
  /** Fired for each text delta of an in-flight inline-AI request (keyed by the
   * caller's requestId) so the editor can insert the generation live. */
  onAiStreamed: event<{ requestId: string; delta: string }>("ai:streamed"),

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
// Method partitions — hosts and transports slice the registry along these
// lines: events are host → UI pushes (no handler), the updater trio is
// implemented by the desktop shell (electron-updater), everything else is a
// host-owned handler.
// ---------------------------------------------------------------------------

/** Host → UI push channels. */
export type EventMethod = {
  [K in IpcMethod]: IpcRegistry[K] extends { kind: "event" } ? K : never;
}[IpcMethod];

/** Self-update methods only the Electron shell can implement — a non-desktop
 * transport has no handler for these and the UI hides the affordance. */
export const UPDATE_METHODS = ["checkForUpdates", "downloadUpdate", "installUpdate"] as const;
export type UpdateMethod = (typeof UPDATE_METHODS)[number];

/** Methods the platform-agnostic host implements. */
export type HostMethod = Exclude<IpcMethod, EventMethod | UpdateMethod>;

// Object.keys returns string[]; the predicate re-proves membership so the
// typed list needs no assertion.
function methodNames<T extends Record<string, IpcEntry>>(registry: T): Array<keyof T & string> {
  return Object.keys(registry).filter((key): key is keyof T & string =>
    Object.hasOwn(registry, key),
  );
}

/** Every registry method, as a runtime list (for folds and completeness checks). */
export const IPC_METHODS: IpcMethod[] = methodNames(IPC);

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

/** The transport-agnostic host contract the UI consumes. Derived from the
 * registry; each host (Electron preload today, WS server later) implements it. */
export type Bridge = {
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
