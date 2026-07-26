// ---------------------------------------------------------------------------
// IPC registry — single source of truth for every channel that crosses the
// host <-> renderer boundary. Each entry pairs a TypeBox payload schema (for
// runtime validation) with a TypeScript result/event type (for compile-time
// inference); the registry KEY is the method name on the wire. The Bridge type
// and the ws transport's dispatch are both derived from this registry, so a
// rename here is a compile error everywhere it matters.
// ---------------------------------------------------------------------------

import { type Static, type TSchema, type TString, type TUndefined, Type } from "@sinclair/typebox";

import type { AppAgentEvent } from "./agent-events";
import {
  AiProviderRefSchema,
  AiProviderSetConfigSchema,
  type AiConnectResult,
  type AiProviderSettings,
} from "./ai-provider";
import { AppEventSchema, type AppState } from "./app-state";
import type { ChatHistoryEntry } from "./chat-log";
import {
  ReadChatSessionSchema,
  type ChatSessionSummary,
  type ReadChatSessionResult,
} from "./chat-sessions";
import type { DeepLinkNavEvent } from "./deep-link";
import {
  ConnectorInstallRequestSchema,
  ConnectorUninstallRequestSchema,
  CreateOAuthClientInputSchema,
  ExecutorConnectionSchema,
  ExecutorDetectResultSchema,
  ExecutorIntegrationSchema,
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
import type { SearchResult } from "@repo/notes/knowledge/knowledge-index";
import type {
  BacklinkEntry,
  ForwardLinkEntry,
  LinkGraph,
  VaultTaskEntry,
  WikiTarget,
} from "@repo/notes/knowledge/link-graph-index";
import type { RelatedNoteEntry } from "@repo/notes/knowledge/related-notes";
import type { TagCount } from "@repo/notes/knowledge/tag-index";
import type { NotePrivacy } from "@repo/notes/markdown/frontmatter";
import {
  RemoteAccessSetConfigSchema,
  RevokeDeviceSchema,
  type PairingInfo,
  type RemoteAccessState,
} from "./remote-access";
import {
  UpsertRoutineParamsSchema,
  type ListRoutinesResult,
  type RunRoutineNowResult,
  type UpsertRoutineResult,
} from "./routines";
import type { SyncOutcome } from "@repo/notes/sync/engine";
import {
  SyncRequestPasswordResetSchema,
  SyncSetConfigSchema,
  SyncSignInSchema,
  SyncSignUpSchema,
  SyncSocialSignInSchema,
  type AccountCapabilities,
  type SyncSignInResult,
  type SyncState,
} from "./sync";
import { UiStateSetSchema } from "./ui-state";
import { TextChatMessageSchema } from "./chat-message";

// ---------------------------------------------------------------------------
// Shared shapes referenced by registry entries
// ---------------------------------------------------------------------------

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

export type ExecutorStatus =
  | { running: false }
  // redirectUri is the daemon's browser-facing OAuth callback — surfaced so
  // the Google client dialog can show the exact URI to whitelist in GCP.
  | { running: true; redirectUri: string };

/** Result of ensureGoogleOAuthClient: "ready" means the shared "google"
 * client exists in executor and consent can start; "unavailable" means it
 * doesn't — the renderer falls back to the paste-your-own-GCP-app dialog. */
export type EnsureGoogleClientResult = { status: "ready" } | { status: "unavailable" };

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
  /** "user" (<agentDir>/skills) or "project" (<cwd>/.pi/skills). */
  scope: string;
  filePath: string;
};

export type SkillsList = {
  skills: SkillInfo[];
};

const NotificationsPatchSchema = Type.Object(
  { enabled: Type.Optional(Type.Boolean()) },
  { additionalProperties: false },
);

// Dev-only faux-agent scripting: one step per assistant turn
// — optional text plus optional tool calls (e.g. pi's `edit` performing a
// delegation's write-back), mapped host-side onto pi-ai's faux helpers. The
// handler throws unless INTELIGIR_FAUX_AGENT=1, so the channel never does
// anything in production.
const FauxAgentScriptSchema = Type.Object(
  {
    steps: Type.Array(
      Type.Object(
        {
          text: Type.Optional(Type.String()),
          toolCalls: Type.Optional(
            Type.Array(
              Type.Object(
                {
                  name: Type.String({ minLength: 1 }),
                  arguments: Type.Record(Type.String(), Type.Unknown()),
                },
                { additionalProperties: false },
              ),
            ),
          ),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);
export type FauxAgentScript = Static<typeof FauxAgentScriptSchema>;

/** Dev-only: the in-flight connector OAuth consent — the authorize URL
 * (state/PKCE ride in its query string) a headless E2E drive completes
 * against emulate instead of spelunking the daemon's SQLite. Held host-side
 * (connector-install.ts) only under INTELIGIR_EMULATE_CONNECTORS=1; the
 * handler throws otherwise, so production never exposes it. */
export type PendingConnectorAuth = { authorizationUrl: string; state: string };

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

/** The capture-apply verdict — the ONE declaration; the renderer applier and
 * the host CaptureManager both import it, so the ack contract can't fork. */
export type CaptureAckOutcome = Static<typeof AckCaptureSchema>["outcome"];

// ---------------------------------------------------------------------------
// AI-write checkpoints — pre-write copies of vault notes captured at the chat
// agent's tool gate (server restore/restore-manager.ts). Delegation has its
// own pre-run snapshot + dock affordance; these channels serve the CHAT undo.
// ---------------------------------------------------------------------------

/** A chat-agent edit/write on a vault note was checkpointed: the host copied
 * the pre-write bytes before the tool executed. Fired mid-turn; the renderer
 * collects them per turn (first capture per path = the pre-turn bytes) and
 * offers one undo toast when the turn settles. `create` = the write made a
 * new file, so undo deletes it. */
export type AgentEditCaptured = {
  id: string;
  path: string;
  kind: "edit" | "create";
  capturedAt: number;
};

const RestoreAgentEditsSchema = Type.Object(
  { ids: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }) },
  { additionalProperties: false },
);

/** restoreAgentEdits verdict. Partial failures aggregate into one message —
 * whatever could be restored was. */
export type RestoreAgentEditsResult = { ok: true } | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Vault — the user's local knowledge folder (markdown). Paths are
// vault-relative; main confines them under the vault root.
// ---------------------------------------------------------------------------

const VaultPathSchema = Type.Object({ path: Type.String() }, { additionalProperties: false });
// The currently open note the host should watch for external edits (null clears
// it). Only this ONE file is watched — the rest of the vault is an ephemeral
// snapshot refreshed on demand (vault liveness — CLAUDE.md § Decisions).
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

/** chooseVaultRoot's verdict — tagged so consumers switch instead of probing
 * properties. `canceled` is the user dismissing the picker, not a failure. */
export type ChooseVaultResult =
  | { ok: true; root: string }
  | { ok: false; reason: "canceled" }
  | { ok: false; reason: "error"; error: string };

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

/** probeNotePrivacy result: notePrivacy's verdict from a LIVE disk read, plus
 * "absent" when no file exists at the path. Callers treat everything except
 * "public" as private (fail-closed). */
export type NotePrivacyProbe = NotePrivacy | "absent";

// ---------------------------------------------------------------------------
// Knowledge — the host's link + lexical search indexes over the vault
// (backlinks, graph, palette search, wiki autocomplete). Result shapes live
// in @repo/notes/knowledge next to the engine that produces them
// (link-graph-index, tag-index, knowledge-index).
// ---------------------------------------------------------------------------

const KnowledgeSearchSchema = Type.Object(
  {
    query: Type.String(),
    limit: Type.Optional(Type.Number({ minimum: 1, maximum: 200 })),
  },
  { additionalProperties: false },
);

const KnowledgeTagSchema = Type.Object({ tag: Type.String() }, { additionalProperties: false });

// Guarded task toggle — keyed by ORDINAL (delegation's anchor key; survives
// line shifts and duplicate identical lines) plus the exact recorded line.
const ToggleTaskSchema = Type.Object(
  {
    path: Type.String(),
    /** Position among the file's GFM task items (find-task-line's counting). */
    ordinal: Type.Number({ minimum: 0 }),
    /** The task's exact untrimmed source line (terminator excluded) as the
     * projection recorded it — the write proceeds only on byte equality. */
    expectedRaw: Type.String(),
  },
  { additionalProperties: false },
);

/** toggleVaultTask's verdict. Failures are VALUES, never throws: the host has
 * already kicked an index refresh, so the renderer refetches + toasts. */
export type ToggleTaskResult =
  | { ok: true; checked: boolean }
  | { ok: false; reason: "line-missing" | "line-changed" | "not-a-checkbox"; error: string };

// Float32Array / ArrayBuffer / ArrayBufferView don't have a TypeBox primitive;
// approximate with Type.Unknown plus a runtime narrow at the handler.
// UNKNOWN, never Any: both emit the same `{}` schema (so the wire format and
// Value.Check behaviour are identical), but Any would put a real `any` into
// the derived Bridge type — silently exempting every caller and every handler
// of this channel from the repo's no-explicit-any rule. `unknown` forces the
// host to narrow, which is where the ArrayBuffer/view check actually belongs:
// the binary transport hands the handler a standalone ArrayBuffer, but the
// same registry entry is also reachable over a JSON `send` frame carrying
// arbitrary JSON, so the shape must be proven rather than assumed.
const BinaryAudioSchema = Type.Unknown();

const TtsSendSchema = Type.Object({ text: Type.String() }, { additionalProperties: false });

/** setVoiceApiKey payload: a non-empty `value` stores the key; anything else
 * (absent, empty, whitespace) clears it. */
const VoiceApiKeySchema = Type.Object(
  { value: Type.Optional(Type.String()) },
  { additionalProperties: false },
);

// ---------------------------------------------------------------------------
// Entry helpers — phantom types carry result/event shapes through the registry
// ---------------------------------------------------------------------------

// The `_payload`/`_result`/`_event` fields are phantom: optional and never
// set at runtime, they exist purely so `infer` can pull the wire types back
// out of an entry (see Bridge / IpcResult below).
type Invoke<S extends TSchema, R> = {
  readonly kind: "invoke";
  readonly payload: S;
  readonly _payload?: Static<S>;
  readonly _result?: R;
};

type InvokeVoid<R> = {
  readonly kind: "invoke-void";
  readonly _result?: R;
};

type Send<S extends TSchema> = {
  readonly kind: "send";
  readonly payload: S;
  readonly _payload?: Static<S>;
};

type Event<E> = {
  readonly kind: "event";
  readonly _event?: E;
};

type IpcEntry = Invoke<TSchema, unknown> | InvokeVoid<unknown> | Send<TSchema> | Event<unknown>;

const invoke = <S extends TSchema, R>(payload: S): Invoke<S, R> => ({
  kind: "invoke",
  payload,
});
const invokeVoid = <R>(): InvokeVoid<R> => ({ kind: "invoke-void" });
const send = <S extends TSchema>(payload: S): Send<S> => ({ kind: "send", payload });
const event = <E>(): Event<E> => ({ kind: "event" });

// ---------------------------------------------------------------------------
// The registry — every method that crosses the IPC boundary
// ---------------------------------------------------------------------------

export const IPC = {
  // App lifecycle
  getAppState: invokeVoid<AppState>(),
  transition: invoke<typeof AppEventSchema, void>(AppEventSchema),
  onAppState: event<AppState>(),
  onSetupProgress: event<SetupProgress>(),

  // Agent
  onAgentEvent: event<AppAgentEvent>(),
  sendAgentCommand: invoke<typeof TextChatMessageSchema, void>(TextChatMessageSchema),
  getAgentHistory: invokeVoid<ChatHistoryEntry[]>(),
  /** Past chat threads on disk, newest first; the ACTIVE thread is excluded
   * (it's already the live chat). Read-only browsing — see ./chat-sessions:
   * there is deliberately no resume-arbitrary-session channel. */
  listChatSessions: invokeVoid<ChatSessionSummary[]>(),
  /** One past thread's transcript (getAgentHistory's shape). Unknown or
   * malformed ids come back as an { ok: false } VALUE, never a throw. */
  readChatSession: invoke<typeof ReadChatSessionSchema, ReadChatSessionResult>(
    ReadChatSessionSchema,
  ),
  reauthenticate: invokeVoid<{ ok: true } | { ok: false; error: string }>(),
  /** Dev-only (INTELIGIR_FAUX_AGENT=1; throws otherwise): replace the faux
   * provider's queued responses so a headless E2E drive scripts exact agent
   * turns. One step is consumed per assistant turn across EVERY faux-backed
   * agent (chat + background delegation share one queue — script, then drive
   * exactly one flow). Empty `steps` restores the self-refilling echo. */
  setFauxAgentScript: invoke<typeof FauxAgentScriptSchema, void>(FauxAgentScriptSchema),
  /** Dev-only (INTELIGIR_FAUX_AGENT=1; throws otherwise): the chat session's
   * composed system prompt, or null before the agent starts. Lets a headless
   * E2E drive assert injected context (e.g. vault/AGENTS.md instructions)
   * actually reached the constructed session. */
  getAgentSystemPrompt: invokeVoid<string | null>(),

  // AI provider — WHICH pi provider+model the agent surfaces run on. These
  // channels move only the SELECTION and per-provider connected booleans;
  // tokens stay on-device in pi's auth.json and never cross the Bridge.
  /** Selection + every offered provider with connected state and model menu. */
  getAiProviderSettings: invokeVoid<AiProviderSettings>(),
  /** Patch the selection (partial; a provider switch defaults the model).
   * Rolls the live sessions so the next turn runs the new provider+model. */
  setAiProviderConfig: invoke<typeof AiProviderSetConfigSchema, AiProviderSettings>(
    AiProviderSetConfigSchema,
  ),
  /** Run the interactive OAuth connect flow for one provider (opens the
   * system browser; resolves when credentials land in pi's auth.json). */
  connectAiProvider: invoke<typeof AiProviderRefSchema, AiConnectResult>(AiProviderRefSchema),
  /** Drop one provider's on-device credentials. */
  disconnectAiProvider: invoke<typeof AiProviderRefSchema, AiProviderSettings>(AiProviderRefSchema),

  // Voice
  isTtsAvailable: invokeVoid<boolean>(),
  /** Store/clear the ElevenLabs API key. Voice owns its secret: the handler
   * writes the encrypted SecretStore directly and keeps only a `true`
   * presence marker under ELEVENLABS_API_KEY_UI_STATE in ui-state (which is
   * what getUiState exposes to Settings) — plaintext never crosses back. */
  setVoiceApiKey: invoke<typeof VoiceApiKeySchema, void>(VoiceApiKeySchema),
  ttsSend: send<typeof TtsSendSchema>(TtsSendSchema),
  ttsFlush: send<TUndefined>(Type.Undefined()),
  ttsInterrupt: send<TUndefined>(Type.Undefined()),
  onTtsAudio: event<{ audio: ArrayBuffer }>(),
  startStt: invokeVoid<{ ok: true } | { ok: false; error: string }>(),
  // ArrayBuffer / ArrayBufferView can't be expressed in TypeBox; the payload
  // arrives `unknown` and the host narrows it (voice-handlers' toFloat32Samples).
  sendSttAudio: send<typeof BinaryAudioSchema>(BinaryAudioSchema),
  stopStt: invokeVoid<Array<{ text: string; isFinal: boolean }>>(),
  onSttTranscript: event<{ text: string; isFinal: boolean }>(),
  onVoiceModelState: event<VoiceModelStateEvent>(),

  // Notifications
  getNotificationSettings: invokeVoid<NotificationSettings>(),
  updateNotificationSettings: invoke<typeof NotificationsPatchSchema, NotificationSettings>(
    NotificationsPatchSchema,
  ),

  // UI state
  getUiState: invokeVoid<Record<string, unknown>>(),
  setUiState: invoke<typeof UiStateSetSchema, void>(UiStateSetSchema),

  // Vault (knowledge folder) — trusted renderer surface for the editor.
  getVaultRoot: invokeVoid<string>(),
  chooseVaultRoot: invokeVoid<ChooseVaultResult>(),
  listVault: invokeVoid<VaultEntry[]>(),
  readVaultDoc: invoke<typeof VaultPathSchema, string>(VaultPathSchema),
  writeVaultDoc: invoke<typeof VaultWriteDocSchema, void>(VaultWriteDocSchema),
  deleteVaultEntry: invoke<typeof VaultPathSchema, { removed: boolean }>(VaultPathSchema),
  /** Rename/move a file to a new vault-relative path (creating parent dirs).
   * Refuses to clobber an existing file. */
  renameVaultEntry: invoke<typeof VaultRenameSchema, { ok: true } | { ok: false; error: string }>(
    VaultRenameSchema,
  ),
  /** Write image (or other) bytes into the vault under `dir` (e.g. "assets"),
   * picking a collision-free name derived from `baseName`. Returns the final
   * vault-relative path. The editor's paste/drop image ingestion uses this. */
  writeVaultAsset: invoke<typeof VaultWriteAssetSchema, { path: string }>(VaultWriteAssetSchema),
  /** Read an in-vault asset's bytes as base64 (image rendering). Capped; a
   * missing/oversized file returns `{ ok: false }` rather than throwing. */
  readVaultAsset: invoke<typeof VaultPathSchema, ReadVaultAssetResult>(VaultPathSchema),
  /** Mint a per-open token authorizing `vault-app://` reads for one HTML-App
   * open. Desktop-shell-only: the token lives in the main-process token store
   * the protocol handler checks, so this can't be a platform-neutral host
   * handler (see DESKTOP_SHELL_METHODS). */
  mintHtmlAppToken: invokeVoid<string>(),
  /** Revoke a per-open token when its HTML-App closes/unmounts, so a captured
   * or leaked token can't keep reading the vault. The FIFO bound in
   * vault-app-protocol.ts is a backstop, not a substitute — this is the normal
   * path. Desktop-shell-only, same reasoning as `mintHtmlAppToken`. */
  revokeHtmlAppToken: invoke<typeof HtmlAppTokenSchema, void>(HtmlAppTokenSchema),
  /** LIVE-disk privacy probe for one note — the SAME probe the agent tool
   * gate runs (never an index, never the renderer buffer). The context-hint
   * path needs it: a sync pull or agent write can flip a note `private: true`
   * on disk before the open-note watcher refreshes the editor buffer, and a
   * private note's PATH must not reach the model either. */
  probeNotePrivacy: invoke<typeof VaultPathSchema, NotePrivacyProbe>(VaultPathSchema),
  /** Tell the host which note is open so it watches that single file for
   * external edits (vault liveness — CLAUDE.md § Decisions). Pass
   * `{ path: null }` when no note is open. */
  setWatchedNote: invoke<typeof WatchedNoteSchema, void>(WatchedNoteSchema),
  /** Rebuild the ephemeral snapshot now: re-list + reindex + sync kick. The
   * renderer calls this on window focus (debounced) and from the "Refresh vault"
   * command; the host also calls it internally on delegation completion. */
  refreshVault: invokeVoid<void>(),
  /** Fired on every vault change (file edit by anyone, or a root switch) so the
   * sidebar re-lists and the editor reloads. */
  onVaultChanged: event<{ root: string }>(),

  // Knowledge — link + search indexes over the vault, kept fresh from vault
  // change events. Queries are cheap index reads.
  getBacklinks: invoke<typeof VaultPathSchema, BacklinkEntry[]>(VaultPathSchema),
  getForwardLinks: invoke<typeof VaultPathSchema, ForwardLinkEntry[]>(VaultPathSchema),
  /** Ranked "related notes" for one note — shared link targets, co-citation,
   * shared tags, lexical similarity — each entry carrying human-readable
   * `reasons`. Direct link neighbors are excluded by design (the Links and
   * Backlinks panels already surface them). */
  getRelatedNotes: invoke<typeof VaultPathSchema, RelatedNoteEntry[]>(VaultPathSchema),
  /** Whole-vault link graph, shaped for a force-graph renderer (unresolved
   * targets appear as flagged phantom nodes). */
  getLinkGraph: invokeVoid<LinkGraph>(),
  /** Ranked lexical full-text search (title > heading > body tiers). */
  searchVault: invoke<typeof KnowledgeSearchSchema, SearchResult[]>(KnowledgeSearchSchema),
  /** Every linkable target for the `[[`-autocomplete picker: notes first,
   * then attachments (flagged `type: "asset"` so the picker groups them and
   * inserts `![[embeds]]`). */
  listWikiTargets: invokeVoid<WikiTarget[]>(),
  /** Every tag in the vault with its note count (inline `#tags` ∪ frontmatter
   * `tags`, unified case-insensitively) — the palette's `#` tag list. */
  listTags: invokeVoid<TagCount[]>(),
  /** Vault paths of the notes carrying a tag (case-insensitive). */
  getNotesByTag: invoke<typeof KnowledgeTagSchema, string[]>(KnowledgeTagSchema),
  /** Every task in the vault (checked and not), path-then-ordinal — the Tasks
   * view's whole-vault query over the projection. */
  listVaultTasks: invokeVoid<VaultTaskEntry[]>(),
  /** Guarded checkbox toggle: re-read the file, locate the ordinal-th task
   * item, require its current line to equal `expectedRaw` byte-for-byte, and
   * flip only the marker char (atomic write; the watcher broadcasts). On ANY
   * {ok:false} the host refreshes the index (self-heal) and the renderer
   * refetches + toasts — refuse loudly, never write wrong. Invalidation rides
   * the existing onKnowledgeUpdated event. */
  toggleVaultTask: invoke<typeof ToggleTaskSchema, ToggleTaskResult>(ToggleTaskSchema),
  /** Fired after every index refresh so backlink panes / graph views
   * re-query. */
  onKnowledgeUpdated: event<Record<string, never>>(),

  // Delegation — a checkbox handed to a background agent.
  createDelegation: invoke<typeof CreateDelegationParamsSchema, CreateDelegationResult>(
    CreateDelegationParamsSchema,
  ),
  listDelegations: invokeVoid<ListDelegationsResult>(),
  cancelDelegation: invoke<TString, { ok: boolean }>(Type.String({ minLength: 1 })),
  /** Restore the target file's pre-run bytes (captured before the background
   * agent dispatched). Writes atomically through the vault, so the watcher's
   * standard onVaultChanged refreshes editors; no-op success when the file
   * already matches the snapshot. Records `restoredAt` on the delegation. */
  restoreDelegationSnapshot: invoke<TString, RestoreSnapshotResult>(Type.String({ minLength: 1 })),
  /** Fired on every delegation status change so the editor's inline badges
   * stay live. */
  onDelegationsUpdated: event<ListDelegationsResult>(),
  /** Fired as a running delegation streams its response text (accumulating,
   * keyed by id) so the response dock can show it live. */
  onDelegationStreamed: event<{ id: string; text: string }>(),

  // Routines — scheduled agent tasks (delegation's sibling: the same
  // background session, serialized with it; results append to a target note).
  listRoutines: invokeVoid<ListRoutinesResult>(),
  /** Create (no id) or edit (with id) a routine's config; run bookkeeping is
   * host-owned. Refuses a private target note up front (run time re-checks). */
  upsertRoutine: invoke<typeof UpsertRoutineParamsSchema, UpsertRoutineResult>(
    UpsertRoutineParamsSchema,
  ),
  deleteRoutine: invoke<TString, { ok: boolean }>(Type.String({ minLength: 1 })),
  /** Queue an immediate run (Settings "Run now" — works on disabled routines
   * too, as the test-your-config affordance). Serialized like any run. */
  runRoutineNow: invoke<TString, RunRoutineNowResult>(Type.String({ minLength: 1 })),
  /** Restore the target note's pre-run bytes from the routine's LAST run
   * snapshot (the append is undone; a run that created the note trashes it). */
  restoreRoutineRun: invoke<TString, RestoreSnapshotResult>(Type.String({ minLength: 1 })),
  /** Fired on every routines change (config, run start/finish) so Settings →
   * Routines stays live. */
  onRoutinesUpdated: event<ListRoutinesResult>(),

  // AI-write checkpoints — the chat agent's undo (see the section header on
  // AgentEditCaptured above).
  /** A chat-agent write was checkpointed pre-execution — drives the
   * post-turn undo toast. */
  onAgentEditCaptured: event<AgentEditCaptured>(),
  /** Undo a set of chat checkpoints: each `edit` writes its pre-write bytes
   * back atomically through the vault (no-op when already matching; the
   * open-note watcher refreshes editors), each `create` moves the created
   * file to the OS trash. The renderer flushes the open note FIRST so the
   * restore never fights a dirty buffer. */
  restoreAgentEdits: invoke<typeof RestoreAgentEditsSchema, RestoreAgentEditsResult>(
    RestoreAgentEditsSchema,
  ),

  // Deep-link capture — inteligir://append|task. The host enqueues to a
  // durable inbox and offers the line to the renderer; only the OPEN note is
  // ever applied through the live buffer (the no-clobber path) — everything
  // else drains host-side onto today's note.
  /** A capture targets the open note: apply `line` through the live editor
   * buffer so the next autosave persists it (a host disk write to an open
   * DIRTY note would be overwritten by the next whole-buffer flush). */
  onCaptureApply: event<CaptureApplyEvent>(),
  /** The renderer's capture-apply verdict — see AckCaptureSchema. */
  ackCapture: invoke<typeof AckCaptureSchema, void>(AckCaptureSchema),
  /** A deep-link nav verb arrived (inteligir://today | note/<target> |
   * search?q=). Id-stamped so the renderer can dedupe the cold-launch
   * overlap between this push and the takePendingDeepLinkNav pull. */
  onDeepLinkNav: event<DeepLinkNavEvent>(),
  /** Pull-and-clear the parked nav on mount — a cold launch delivers the URL
   * before any renderer subscribed. Callers MUST subscribe onDeepLinkNav
   * BEFORE pulling (the reverse order silently drops a nav landing between
   * the two) and dedupe by event id. */
  takePendingDeepLinkNav: invokeVoid<DeepLinkNavEvent | null>(),

  // Inline AI — one-shot text generation for the editor's AI menu (generate
  // and edit flows), run on an isolated no-tools session.
  generateInlineAi: invoke<typeof AiGenerateParamsSchema, AiGenerateResult>(AiGenerateParamsSchema),
  /** Fired for each text delta of an in-flight inline-AI request (keyed by the
   * caller's requestId) so the editor can insert the generation live. */
  onAiStreamed: event<{ requestId: string; delta: string }>(),
  /** Abort an in-flight generateInlineAi turn (Escape mid-stream). */
  cancelInlineAi: invoke<typeof AiCancelParamsSchema, void>(AiCancelParamsSchema),
  /** Classify a free-form AI-menu prompt as generate vs edit intent. Runs on
   * the inline-AI session; unparseable answers fall back to generate. */
  classifyAiIntent: invoke<typeof AiIntentParamsSchema, AiIntentResult>(AiIntentParamsSchema),
  /** One ghost-text completion on the dedicated fast session. A new request
   * supersedes (aborts) the previous one. */
  generateGhostText: invoke<typeof GhostTextParamsSchema, GhostTextResult>(GhostTextParamsSchema),
  /** Abort an in-flight ghost completion (typing / Escape / blur). */
  cancelGhostText: invoke<typeof AiCancelParamsSchema, void>(AiCancelParamsSchema),
  /** Models the ghost-text session can run (for the settings picker). */
  listGhostModels: invokeVoid<GhostModelsResult>(),

  // Executor (v1.5 model: integrations = catalog, connections = credentials).
  // There are no sources/secrets channels — a secret is a connection
  // credential value; Google goes through add-openapi (googleDiscoveryBundle).
  // There are no per-step integration/connection/OAuth channels either:
  // install/uninstall is host-orchestrated, so the renderer needs only
  // status + the read lists + the Google-client dialogs' create/ensure.
  executorStatus: invokeVoid<ExecutorStatus>(),
  listExecutorIntegrations: invokeVoid<Static<typeof ExecutorIntegrationSchema>[]>(),
  detectExecutorIntegration: invoke<TString, Static<typeof ExecutorDetectResultSchema>[]>(
    Type.String(),
  ),
  listExecutorConnections: invokeVoid<Static<typeof ExecutorConnectionSchema>[]>(),
  createExecutorOAuthClient: invoke<typeof CreateOAuthClientInputSchema, { client: string }>(
    CreateOAuthClientInputSchema,
  ),
  ensureGoogleOAuthClient: invokeVoid<EnsureGoogleClientResult>(),
  // Connector install/uninstall — host-orchestrated (register integration →
  // mint connection → browser OAuth → rollback on failure) in
  // @repo/connectors/connector-install.ts; the renderer sends ONE request per
  // user action and surfaces the rejection message on failure.
  installConnector: invoke<typeof ConnectorInstallRequestSchema, void>(
    ConnectorInstallRequestSchema,
  ),
  uninstallConnector: invoke<typeof ConnectorUninstallRequestSchema, void>(
    ConnectorUninstallRequestSchema,
  ),
  /** Dev-only (INTELIGIR_EMULATE_CONNECTORS=1; throws otherwise): the
   * in-flight connector OAuth consent, or null when none is pending. */
  getPendingConnectorAuth: invokeVoid<PendingConnectorAuth | null>(),

  // Vault sync — reconcile the local vault against the coordinator Worker.
  // OFF by default; gated at runtime by the sync-config store + a bearer token.
  /** Current sync state (enabled/signed-in/coordinator/last-status). */
  getSyncState: invokeVoid<SyncState>(),
  /** Patch the sync config (enable toggle + coordinator URL). */
  setSyncConfig: invoke<typeof SyncSetConfigSchema, SyncState>(SyncSetConfigSchema),
  /** Email+password sign-in against the configured coordinator. */
  syncSignIn: invoke<typeof SyncSignInSchema, SyncSignInResult>(SyncSignInSchema),
  /** Ask the coordinator to email a password-reset link. NEUTRAL by
   * contract: `ok` means "request accepted", NEVER "that email exists" — the
   * coordinator answers identically for known and unknown emails, and the
   * renderer shows the same "if that email has an account…" copy either way.
   * `ok:false` carries only transport/config failures (no coordinator URL,
   * network down), which reveal nothing about any account. */
  syncRequestPasswordReset: invoke<typeof SyncRequestPasswordResetSchema, SyncSignInResult>(
    SyncRequestPasswordResetSchema,
  ),
  /** Email+password sign-UP (guest→account upgrade); success signs in. */
  syncSignUp: invoke<typeof SyncSignUpSchema, SyncSignInResult>(SyncSignUpSchema),
  /** INITIATE social OAuth for a capability-listed provider: opens the system
   * browser at the coordinator's authorization URL. ok = browser opened —
   * the session lands on-device when the `inteligir://session` deep link
   * completes the exchange (see onSocialSignInResult). */
  syncSocialSignIn: invoke<typeof SyncSocialSignInSchema, SyncSignInResult>(SyncSocialSignInSchema),
  /** The RESULT of a social sign-in's deep-link completion (the
   * `inteligir://session` callback → HTTPS code exchange → session adoption).
   * Deep-link-driven — there is no request to respond to — so the account
   * UI's "finish in your browser…" pending state resolves on this event: ok
   * clears it (onSyncStateChanged flips signedIn too), an error carries the
   * user-facing message (expired/replayed link, exchange failure). */
  onSocialSignInResult: event<SyncSignInResult>(),
  /** Which social providers the configured coordinator serves (env-gated
   * server-side) — drives the Account section's social buttons. */
  getAccountCapabilities: invokeVoid<AccountCapabilities>(),
  /** Clear the local session (best-effort remote revoke). */
  syncSignOut: invokeVoid<void>(),
  /** Force one reconcile pass now; returns the outcome. */
  syncNow: invokeVoid<SyncOutcome>(),
  /** Fired on every config / auth / status change so the settings Sync UI is
   * reactive. Same shape as getSyncState. */
  onSyncStateChanged: event<SyncState>(),

  // Remote access — the WS transport's device-pairing surface: an enable
  // toggle, LAN URLs, paired devices, and one-time pairing tokens. All state
  // reads/writes go through the remote-access manager.
  /** Current remote-access state (enabled/port/listening/lanUrls/devices). */
  getRemoteAccessState: invokeVoid<RemoteAccessState>(),
  /** Patch the remote-access config (enable toggle only; port stays fixed). */
  setRemoteAccessConfig: invoke<typeof RemoteAccessSetConfigSchema, RemoteAccessState>(
    RemoteAccessSetConfigSchema,
  ),
  /** Mint a one-time pairing token (10-minute TTL) for another device to
   * redeem over the ws transport's `pair` frame. */
  createPairingToken: invokeVoid<PairingInfo>(),
  /** Forget a paired device — its token stops validating immediately. */
  revokeRemoteDevice: invoke<typeof RevokeDeviceSchema, RemoteAccessState>(RevokeDeviceSchema),
  /** Fired on every remote-access config / device / listen change. */
  onRemoteAccessChanged: event<RemoteAccessState>(),

  // Skills
  listSkills: invokeVoid<SkillsList>(),

  // Integrations
  listIntegrations: invokeVoid<IntegrationInfo[]>(),
  repairIntegrations: invokeVoid<void>(),
} as const satisfies Record<string, IpcEntry>;

type IpcRegistry = typeof IPC;
export type IpcMethod = keyof IpcRegistry;

// ---------------------------------------------------------------------------
// Method partitions — hosts and transports slice the registry along these
// lines: events are host → UI pushes (no handler), the desktop-shell methods
// are implemented by the Electron shell, everything else is a host-owned
// handler.
// ---------------------------------------------------------------------------

/** Host → UI push channels. */
export type EventMethod = {
  [K in IpcMethod]: IpcRegistry[K] extends { kind: "event" } ? K : never;
}[IpcMethod];

/** Desktop-shell-only methods: `mintHtmlAppToken` and `revokeHtmlAppToken`
 * touch the main-process token store the `vault-app://` protocol checks, so
 * the platform-agnostic host has no handler for them and a non-desktop
 * transport must stub them. */
export const DESKTOP_SHELL_METHODS = ["mintHtmlAppToken", "revokeHtmlAppToken"] as const;
export type DesktopShellMethod = (typeof DESKTOP_SHELL_METHODS)[number];

// ---------------------------------------------------------------------------
// Remote-device capability allowlists.
//
// A paired remote device (the Expo companion) is NOT the desktop renderer: it
// authenticates with a revocable device token over the network, so it must
// reach only the narrow companion surface, never the host machine.
//
// These are ALLOWLISTS, not blocklists, and that direction is the point: a new
// channel is unreachable from a paired device until someone adds it here on
// purpose. The previous shape — a LOCAL_ONLY_METHODS blocklist naming four
// remote-access channels — silently exposed every channel added after it,
// including `transition` (RESET_APP_DATA wipes ~/.inteligir), `chooseVaultRoot`
// and `connectAiProvider` (native dialogs on the host's screen),
// `repairIntegrations` (rewrites host binaries) and `setVoiceApiKey`.
//
// The ws host enforces all three of these per-session: invoke/send at dispatch,
// events at broadcast, and the reconnect hydration push (which resolves through
// the same dispatch map and would otherwise hand a remote device the state of a
// getter it is forbidden to call).
// ---------------------------------------------------------------------------

/** The ONLY methods a paired remote device may invoke. Everything else — the
 * whole vault/knowledge/settings/provider/sync/remote-access surface and the
 * desktop-shell methods — is local-session-only. Mobile reads vault CONTENT
 * through vault sync (R2), never through these channels, so its host-bridge
 * surface is just chat + the delegation dock. */
export const REMOTE_ALLOWED_METHODS = [
  "getAgentHistory",
  "sendAgentCommand",
  "listDelegations",
  "cancelDelegation",
  "restoreDelegationSnapshot",
] as const satisfies readonly IpcMethod[];

/** The ONLY events pushed to a paired remote device, at broadcast AND at
 * reconnect hydration. Notably excluded: `onRemoteAccessChanged` (pairing
 * tokens + the device roster — the admin plane the method gate protects) and
 * `onTtsAudio` (spoken note content as raw PCM). */
export const REMOTE_ALLOWED_EVENTS = [
  "onAgentEvent",
  "onDelegationsUpdated",
  "onDelegationStreamed",
] as const satisfies readonly EventMethod[];

// ---------------------------------------------------------------------------
// Binary channels.
//
// A handful of channels carry raw PCM at streaming rates, where base64-in-JSON
// would be wasteful. Those cross as `[1-byte tag][payload bytes]` binary frames
// instead (ws-protocol.ts). This table is the ONLY place that mapping lives:
// the transports (ws-bridge, ws-host) read it instead of naming any channel
// themselves, so removing the voice capability is two entries here rather than
// surgery on both endpoints.
//
// `field` distinguishes the two payload conventions: absent means the channel's
// payload IS the buffer (a send), present means the payload is a record with
// the buffer under that key (an event), and the transports pack/unpack it.
//
// Tags are wire values — never renumber one; retire it and take the next.
// ---------------------------------------------------------------------------

export const BINARY_CHANNELS = [
  { method: "sendSttAudio", tag: 1 },
  { method: "onTtsAudio", tag: 2, field: "audio" },
] as const satisfies readonly { method: IpcMethod; tag: number; field?: string }[];

export type BinaryChannel = (typeof BINARY_CHANNELS)[number];

/** Binary-channel descriptor for `method`, or undefined for a JSON channel. */
export function binaryChannelFor(method: string): BinaryChannel | undefined {
  return BINARY_CHANNELS.find((channel) => channel.method === method);
}

/** Binary-channel descriptor for a received frame's tag. */
export function binaryChannelForTag(tag: number): BinaryChannel | undefined {
  return BINARY_CHANNELS.find((channel) => channel.tag === tag);
}

/** Methods the platform-agnostic host implements. */
export type HostMethod = Exclude<IpcMethod, EventMethod | DesktopShellMethod>;

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
  onRoutinesUpdated: "listRoutines",
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
 * registry; each host (the ws bridge on desktop/mobile, the dev harness's
 * fixture Bridge) implements it. */
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
