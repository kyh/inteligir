// ---------------------------------------------------------------------------
// IPC registry — single source of truth for every channel that crosses the
// main <-> preload <-> renderer boundary. Each entry pairs a channel name
// with a TypeBox payload schema (for runtime validation) and a TypeScript
// result/event type (for compile-time inference). The Bridge type
// and the preload bridge object are both derived from this registry, so a
// rename here is a compile error everywhere it matters.
// ---------------------------------------------------------------------------

import { type Static, type TSchema, Type } from "@sinclair/typebox";

import type { AppAgentEvent } from "./agent-events";
import { AppEventSchema, type AppState } from "./app-state";
import type { DeepLinkNavEvent } from "./deep-link";
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
  type RestoreSnapshotResult,
} from "./delegation";
import {
  AiCancelParamsSchema,
  AiGenerateParamsSchema,
  AiIntentParamsSchema,
  GhostTextParamsSchema,
  type AiGenerateResult,
  type AiIntentResult,
  type GhostModelsResult,
  type GhostTextResult,
} from "./inline-ai";
import type {
  BacklinkEntry,
  ForwardLinkEntry,
  LinkGraph,
  SearchResult,
  TagCount,
  WikiTarget,
} from "@repo/core/knowledge/knowledge-index";
import {
  RemoteAccessSetConfigSchema,
  RevokeDeviceSchema,
  type PairingInfo,
  type RemoteAccessState,
} from "./remote-access";
import {
  SyncSetConfigSchema,
  SyncSignInSchema,
  type SyncOutcome,
  type SyncSignInResult,
  type SyncState,
} from "./sync";
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

/** Plain projection of pi's `Skill` so callers can serialize it over IPC. */
export type SkillInfo = {
  name: string;
  description: string;
  /** Where the skill came from, e.g. "user", "project", or a package name. */
  source: string;
  /** "user" (<agentDir>/skills) or "project" (<cwd>/.pi/skills). */
  scope: string;
  filePath: string;
  /** True when the skill is invoke-only (excluded from the model's prompt). */
  disableModelInvocation: boolean;
};

export type SkillsList = {
  skills: SkillInfo[];
};

const NotificationsPatchSchema = Type.Object(
  { enabled: Type.Optional(Type.Boolean()) },
  { additionalProperties: false },
);

// ---------------------------------------------------------------------------
// Deep-link capture — inteligir://append|task landing on today's daily note.
// ---------------------------------------------------------------------------

/** A capture the host wants applied to the OPEN note's live buffer: the
 * durable inbox entry's id, the daily-note path it targets, and the exact
 * (already sanitized) line to append. */
export type CaptureApplyEvent = { id: string; path: string; line: string };

/** The renderer's verdict on a capture-apply: `applied` (persisted through
 * the live buffer — remove the inbox entry), `not-open` (host drains it to
 * disk now), or `deferred` (a transient AI session blocks the buffer — keep
 * the entry, cancel the host's timeout drain, the renderer re-acks when the
 * session settles). */
const AckCaptureSchema = Type.Object(
  {
    id: Type.String(),
    outcome: Type.Union([
      Type.Literal("applied"),
      Type.Literal("not-open"),
      Type.Literal("deferred"),
    ]),
  },
  { additionalProperties: false },
);

// ---------------------------------------------------------------------------
// Vault — the user's local knowledge folder (markdown). Paths are
// vault-relative; main confines them under the vault root.
// ---------------------------------------------------------------------------

const VaultPathSchema = Type.Object({ path: Type.String() }, { additionalProperties: false });
// The currently open note the host should watch for external edits (null clears
// it). Only this ONE file is watched — the rest of the vault is an ephemeral
// snapshot refreshed on demand (ADR-0001).
const WatchedNoteSchema = Type.Object(
  { path: Type.Union([Type.String(), Type.Null()]) },
  { additionalProperties: false },
);
const VaultWriteDocSchema = Type.Object(
  { path: Type.String(), content: Type.String() },
  { additionalProperties: false },
);
const HtmlAppTokenSchema = Type.Object({ token: Type.String() }, { additionalProperties: false });

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

// Attachment ingestion — image (or other) bytes written into the vault. The
// renderer is sandboxed (Bridge-only), so bytes cross as base64 both ways.
const VaultWriteAssetSchema = Type.Object(
  { dir: Type.String(), baseName: Type.String(), bytesBase64: Type.String() },
  { additionalProperties: false },
);

/** readVaultAsset result: base64 bytes of an in-vault file, or an error (the
 * file is missing, escapes the vault, or exceeds the transfer cap). Rendering
 * a broken image is a UI state, not an exception — hence a Result, not a throw. */
export type ReadVaultAssetResult = { ok: true; bytesBase64: string } | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Knowledge — the host's link + lexical search indexes over the vault
// (backlinks, graph, palette search, wiki autocomplete). Result shapes live
// in knowledge/knowledge-index.ts next to the engine that produces them.
// ---------------------------------------------------------------------------

const KnowledgeSearchSchema = Type.Object(
  {
    query: Type.String(),
    limit: Type.Optional(Type.Number({ minimum: 1, maximum: 200 })),
  },
  { additionalProperties: false },
);

const KnowledgeTagSchema = Type.Object({ tag: Type.String() }, { additionalProperties: false });

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
  /** Write image (or other) bytes into the vault under `dir` (e.g. "assets"),
   * picking a collision-free name derived from `baseName`. Returns the final
   * vault-relative path. The editor's paste/drop image ingestion uses this. */
  writeVaultAsset: invoke<typeof VaultWriteAssetSchema, { path: string }>(
    "vault:write-asset",
    VaultWriteAssetSchema,
  ),
  /** Read an in-vault asset's bytes as base64 (image rendering). Capped; a
   * missing/oversized file returns `{ ok: false }` rather than throwing. */
  readVaultAsset: invoke<typeof VaultPathSchema, ReadVaultAssetResult>(
    "vault:read-asset",
    VaultPathSchema,
  ),
  /** Mint a per-open token authorizing `vault-app://` reads for one HTML-App
   * open. Desktop-shell-only: the token lives in the main-process token store
   * the protocol handler checks, so this can't be a platform-neutral host
   * handler (see DESKTOP_SHELL_METHODS). */
  mintHtmlAppToken: invokeVoid<string>("vault:mint-html-app-token"),
  /** Revoke a per-open token when its HTML-App closes/unmounts, so a captured
   * or leaked token can't keep reading the vault. The FIFO bound in
   * vault-app-protocol.ts is a backstop, not a substitute — this is the normal
   * path. Desktop-shell-only, same reasoning as `mintHtmlAppToken`. */
  revokeHtmlAppToken: invoke<typeof HtmlAppTokenSchema, void>(
    "vault:revoke-html-app-token",
    HtmlAppTokenSchema,
  ),
  /** Tell the host which note is open so it watches that single file for
   * external edits (ADR-0001). Pass `{ path: null }` when no note is open. */
  setWatchedNote: invoke<typeof WatchedNoteSchema, void>(
    "vault:set-watched-note",
    WatchedNoteSchema,
  ),
  /** Rebuild the ephemeral snapshot now: re-list + reindex + sync kick. The
   * renderer calls this on window focus (debounced) and from the "Refresh vault"
   * command; the host also calls it internally on delegation completion. */
  refreshVault: invokeVoid<void>("vault:refresh"),
  /** Fired on every vault change (file edit by anyone, or a root switch) so the
   * sidebar re-lists and the editor reloads. */
  onVaultChanged: event<{ root: string }>("vault:changed"),

  // Knowledge — link + search indexes over the vault, kept fresh from vault
  // change events. Queries are cheap index reads.
  getBacklinks: invoke<typeof VaultPathSchema, BacklinkEntry[]>(
    "knowledge:backlinks",
    VaultPathSchema,
  ),
  getForwardLinks: invoke<typeof VaultPathSchema, ForwardLinkEntry[]>(
    "knowledge:forward-links",
    VaultPathSchema,
  ),
  /** Whole-vault link graph, shaped for a force-graph renderer (unresolved
   * targets appear as flagged phantom nodes). */
  getLinkGraph: invokeVoid<LinkGraph>("knowledge:graph"),
  /** Ranked lexical full-text search (title > heading > body tiers). */
  searchVault: invoke<typeof KnowledgeSearchSchema, SearchResult[]>(
    "knowledge:search",
    KnowledgeSearchSchema,
  ),
  /** Every linkable target for the `[[`-autocomplete picker: notes first,
   * then attachments (flagged `type: "asset"` so the picker groups them and
   * inserts `![[embeds]]`). */
  listWikiTargets: invokeVoid<WikiTarget[]>("knowledge:wiki-targets"),
  /** Every tag in the vault with its note count (inline `#tags` ∪ frontmatter
   * `tags`, unified case-insensitively) — the palette's `#` tag list. */
  listTags: invokeVoid<TagCount[]>("knowledge:tags"),
  /** Vault paths of the notes carrying a tag (case-insensitive). */
  getNotesByTag: invoke<typeof KnowledgeTagSchema, string[]>(
    "knowledge:notes-by-tag",
    KnowledgeTagSchema,
  ),
  /** Fired after every index refresh (revision is monotonic) so backlink
   * panes / graph views re-query. */
  onKnowledgeUpdated: event<{ revision: number }>("knowledge:updated"),

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
  /** Restore the target file's pre-run bytes (captured before the background
   * agent dispatched). Writes atomically through the vault, so the watcher's
   * standard onVaultChanged refreshes editors; no-op success when the file
   * already matches the snapshot. Records `restoredAt` on the delegation. */
  restoreDelegationSnapshot: invoke<ReturnType<typeof Type.String>, RestoreSnapshotResult>(
    "delegation:restore-snapshot",
    Type.String({ minLength: 1 }),
  ),
  /** Fired on every delegation status change so the editor's inline badges
   * stay live. */
  onDelegationsUpdated: event<ListDelegationsResult>("delegation:updated"),
  /** Fired as a running delegation streams its response text (accumulating,
   * keyed by id) so the response dock can show it live. */
  onDelegationStreamed: event<{ id: string; text: string }>("delegation:streamed"),

  // Deep-link capture — inteligir://append|task. The host enqueues to a
  // durable inbox and offers the line to the renderer; only the OPEN note is
  // ever applied through the live buffer (the no-clobber path) — everything
  // else drains host-side onto today's note.
  /** A capture targets the open note: apply `line` through the live editor
   * buffer so the next autosave persists it (a host disk write to an open
   * DIRTY note would be overwritten by the next whole-buffer flush). */
  onCaptureApply: event<CaptureApplyEvent>("capture:apply"),
  /** The renderer's capture-apply verdict — see AckCaptureSchema. */
  ackCapture: invoke<typeof AckCaptureSchema, void>("capture:ack", AckCaptureSchema),
  /** A deep-link nav verb arrived (inteligir://today | note/<target> |
   * search?q=). Id-stamped so the renderer can dedupe the cold-launch
   * overlap between this push and the takePendingDeepLinkNav pull. */
  onDeepLinkNav: event<DeepLinkNavEvent>("deep-link:nav"),
  /** Pull-and-clear the parked nav on mount — a cold launch delivers the URL
   * before any renderer subscribed. Callers MUST subscribe onDeepLinkNav
   * BEFORE pulling (the reverse order silently drops a nav landing between
   * the two) and dedupe by event id. */
  takePendingDeepLinkNav: invokeVoid<DeepLinkNavEvent | null>("deep-link:take-pending"),

  // Inline AI — one-shot text generation for the editor's AI menu (generate
  // and edit flows), run on an isolated no-tools session.
  generateInlineAi: invoke<typeof AiGenerateParamsSchema, AiGenerateResult>(
    "ai:generate",
    AiGenerateParamsSchema,
  ),
  /** Fired for each text delta of an in-flight inline-AI request (keyed by the
   * caller's requestId) so the editor can insert the generation live. */
  onAiStreamed: event<{ requestId: string; delta: string }>("ai:streamed"),
  /** Abort an in-flight generateInlineAi turn (Escape mid-stream). */
  cancelInlineAi: invoke<typeof AiCancelParamsSchema, void>(
    "ai:generate-cancel",
    AiCancelParamsSchema,
  ),
  /** Classify a free-form AI-menu prompt as generate vs edit intent. Runs on
   * the inline-AI session; unparseable answers fall back to generate. */
  classifyAiIntent: invoke<typeof AiIntentParamsSchema, AiIntentResult>(
    "ai:classify-intent",
    AiIntentParamsSchema,
  ),
  /** One ghost-text completion on the dedicated fast session. A new request
   * supersedes (aborts) the previous one. */
  generateGhostText: invoke<typeof GhostTextParamsSchema, GhostTextResult>(
    "ai:ghost-text",
    GhostTextParamsSchema,
  ),
  /** Abort an in-flight ghost completion (typing / Escape / blur). */
  cancelGhostText: invoke<typeof AiCancelParamsSchema, void>(
    "ai:ghost-text-cancel",
    AiCancelParamsSchema,
  ),
  /** Models the ghost-text session can run (for the settings picker). */
  listGhostModels: invokeVoid<GhostModelsResult>("ai:ghost-models"),

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

  // Vault sync — reconcile the local vault against the coordinator Worker.
  // OFF by default; gated at runtime by the sync-config store + a bearer token.
  /** Current sync state (enabled/signed-in/coordinator/last-status). */
  getSyncState: invokeVoid<SyncState>("sync:get-state"),
  /** Patch the sync config (enable toggle + coordinator URL). */
  setSyncConfig: invoke<typeof SyncSetConfigSchema, SyncState>(
    "sync:set-config",
    SyncSetConfigSchema,
  ),
  /** Email+password sign-in against the configured coordinator. */
  syncSignIn: invoke<typeof SyncSignInSchema, SyncSignInResult>("sync:sign-in", SyncSignInSchema),
  /** Clear the local session (best-effort remote revoke). */
  syncSignOut: invokeVoid<void>("sync:sign-out"),
  /** Force one reconcile pass now; returns the outcome. */
  syncNow: invokeVoid<SyncOutcome>("sync:now"),
  /** Fired on every config / auth / status change so the settings Sync UI is
   * reactive. Same shape as getSyncState. */
  onSyncStateChanged: event<SyncState>("sync:state-changed"),

  // Remote access — the WS transport's device-pairing surface: an enable
  // toggle, LAN URLs, paired devices, and one-time pairing tokens. All state
  // reads/writes go through the remote-access manager.
  /** Current remote-access state (enabled/port/listening/lanUrls/devices). */
  getRemoteAccessState: invokeVoid<RemoteAccessState>("remote:get-state"),
  /** Patch the remote-access config (enable toggle only; port stays fixed). */
  setRemoteAccessConfig: invoke<typeof RemoteAccessSetConfigSchema, RemoteAccessState>(
    "remote:set-config",
    RemoteAccessSetConfigSchema,
  ),
  /** Mint a one-time pairing token (10-minute TTL) for another device to
   * redeem over the ws transport's `pair` frame. */
  createPairingToken: invokeVoid<PairingInfo>("remote:create-pairing-token"),
  /** Forget a paired device — its token stops validating immediately. */
  revokeRemoteDevice: invoke<typeof RevokeDeviceSchema, RemoteAccessState>(
    "remote:revoke-device",
    RevokeDeviceSchema,
  ),
  /** Fired on every remote-access config / device / listen change. */
  onRemoteAccessChanged: event<RemoteAccessState>("remote:state-changed"),

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

/** Desktop-shell-only methods beyond the updater trio. `mintHtmlAppToken` and
 * `revokeHtmlAppToken` touch the main-process token store the `vault-app://`
 * protocol checks, so (like the updater) the platform-agnostic host has no
 * handler for them and a non-desktop transport must stub them. */
export const DESKTOP_SHELL_METHODS = ["mintHtmlAppToken", "revokeHtmlAppToken"] as const;
export type DesktopShellMethod = (typeof DESKTOP_SHELL_METHODS)[number];

/** Methods only the LOCAL session (the desktop renderer on loopback) may call
 * over the ws transport. Remote paired devices get the data plane, never the
 * admin plane: the remote-access surface would let a compromised device mint
 * shadow pairings or re-enable remote access after a revoke, and the updater
 * and html-app tokens act on the host machine's shell. The ws host enforces
 * this per-session at dispatch. */
export const LOCAL_ONLY_METHODS = [
  "getRemoteAccessState",
  "setRemoteAccessConfig",
  "createPairingToken",
  "revokeRemoteDevice",
  ...UPDATE_METHODS,
  ...DESKTOP_SHELL_METHODS,
] as const satisfies readonly IpcMethod[];

/** Methods the platform-agnostic host implements. */
export type HostMethod = Exclude<IpcMethod, EventMethod | UpdateMethod | DesktopShellMethod>;

/** A method's invoke result type (never for sends/events). */
type ResultOf<K extends IpcMethod> =
  IpcRegistry[K] extends Invoke<TSchema, infer R>
    ? R
    : IpcRegistry[K] extends InvokeVoid<infer R>
      ? R
      : never;

/** The methods whose result type EQUALS event `E`'s payload type — the only
 * provable hydration sources for that event (the tuple check enforces
 * assignability in both directions, so the pair can't drift). */
type HydrationGetter<E extends EventMethod> = {
  [K in IpcMethod]: [ResultOf<K>, IpcEvent<E>] extends [IpcEvent<E>, ResultOf<K>] ? K : never;
}[IpcMethod];

/** Reconnect self-healing: each STATEFUL event channel paired with the getter
 * that answers its current state. A transport pushes every getter's result as
 * an evt frame right after welcome, so a client that missed events while
 * disconnected never sits on stale panels across a rebind (full event replay
 * is deliberately not provided — see the transport design's accepted
 * limitations). Getters resolve through the transport's merged dispatch map
 * (host handlers + shell handlers), so shell-owned stateful channels hydrate
 * too; a getter missing on a given host simply skips its push. */
export const HYDRATED_EVENTS = {
  onRemoteAccessChanged: "getRemoteAccessState",
  onSyncStateChanged: "getSyncState",
  onAppState: "getAppState",
  onDelegationsUpdated: "listDelegations",
  // onUpdateState is deliberately absent: its only provable getter
  // (checkForUpdates) hits the update feed, and hydration runs on EVERY
  // connect — including each mobile foreground resume. No UI consumes the
  // event yet; add a side-effect-free getter before hydrating it.
} as const satisfies { readonly [E in EventMethod]?: HydrationGetter<E> };

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
