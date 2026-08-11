// ---------------------------------------------------------------------------
// THE TABLE. Every channel that crosses the host <-> client boundary, one row
// each, grouped by domain. It is a flat index: row N tells you nothing about
// row N+1, and the whole file can be read one row at a time.
//
// A row pairs a TypeBox payload schema (runtime validation) with a TypeScript
// result/event type (compile-time inference); the KEY is the method name on the
// wire, so a rename here is a compile error everywhere it matters. Payload
// schemas and result types live with their DOMAIN (./vault, ./knowledge,
// ./delegation, …), never here — this file names channels and nothing else.
//
// The two files around it:
//   ./ipc-entry    — the four row kinds and their constructors.
//   ./ipc-contract — what this table DERIVES: the Bridge type, the host's
//                    required-method set, the event partition.
// And the one the compiler cannot write for you:
//   ./channel-policy — the three per-channel opt-ins whose absence is silent.
// ---------------------------------------------------------------------------

import { type TString, type TUndefined, Type } from "@sinclair/typebox";

import { AgentConfirmationReplySchema, RestoreAgentEditsSchema } from "./agent-actions";
import type {
  AgentConfirmationRequest,
  AgentEditCaptured,
  RestoreAgentEditsResult,
} from "./agent-actions";
import type { AppAgentEvent } from "./agent-events";
import { FauxAgentScriptSchema } from "./agent-script";
import {
  AiProviderRefSchema,
  AiProviderSetConfigSchema,
  type AiConnectResult,
  type AiProviderSettings,
} from "./ai-provider";
import { AppEventSchema, type AppState } from "./app-state";
import type { ChatHistoryEntry } from "./chat-log";
import { TextChatMessageSchema } from "./chat-message";
import {
  ReadChatSessionSchema,
  type ChatSessionSummary,
  type ReadChatSessionResult,
} from "./chat-sessions";
import { AckCaptureSchema, type CaptureApplyEvent, type DeepLinkNavEvent } from "./deep-link";
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
import { event, invoke, invokeVoid, send, type IpcEntry } from "./ipc-entry";
import {
  KnowledgeSearchSchema,
  LinkGraphBoundsSchema,
  ToggleTaskSchema,
  type ToggleTaskResult,
} from "./knowledge";
import {
  UpsertRoutineParamsSchema,
  type ListRoutinesResult,
  type RunRoutineNowResult,
  type UpsertRoutineResult,
} from "./routines";
import { CreateSkillSchema, type SkillCreated, type SkillsList } from "./skills";
import { UiStateSetSchema } from "./ui-state";
import {
  NotePathSchema,
  VaultPathSchema,
  VaultRenameSchema,
  VaultWriteAssetSchema,
  VaultWriteFileSchema,
  type DeleteVaultEntryResult,
  type ReadVaultAssetResult,
  type VaultChangedEvent,
  type VaultEntry,
  type VaultFileFacts,
  type WorkspaceBoot,
} from "./vault";
import { BinaryAudioSchema, TtsSendSchema, VoiceApiKeySchema } from "./voice";
import type { SearchResult } from "@repo/notes/knowledge/knowledge-index";
import type {
  BacklinkEntry,
  BoundedLinkGraph,
  ForwardLinkEntry,
  VaultTaskEntry,
  WikiTarget,
} from "@repo/notes/knowledge/link-graph-index";

export const IPC = {
  // App lifecycle
  getAppState: invokeVoid<AppState>(),
  transition: invoke<typeof AppEventSchema, void>(AppEventSchema),
  onAppState: event<AppState>(),

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
  /** Dev-only (AGENT_RUNTIME=scripted; throws otherwise): replace the scripted
   * container's queued responses so a headless E2E drive scripts exact agent
   * turns. One step is consumed per assistant turn, and BOTH lanes are seeded
   * with the same steps — two independent queues, each drained on its own, so a
   * chat turn does not eat the background lane's step. The queues live in the
   * container's memory and do not survive hibernation: script immediately
   * before the turn, and read an echoed reply as "the script was dropped".
   * Empty `steps` restores the self-refilling echo. */
  setFauxAgentScript: invoke<typeof FauxAgentScriptSchema, void>(FauxAgentScriptSchema),
  /** The chat agent's system prompt, composed from the vault on every call —
   * so it answers before any turn has run, and on any runtime. Lets a headless
   * E2E drive assert injected context (e.g. vault/AGENTS.md instructions)
   * byte-for-byte instead of inferring it from model behavior. */
  getAgentSystemPrompt: invokeVoid<string>(),

  // AI provider — WHICH provider+model the agent surfaces run on. These
  // channels move only the SELECTION and per-provider connected booleans; the
  // credential is sealed in the host object and never crosses the Bridge.
  /** Selection + every offered provider with connected state and model menu. */
  getAiProviderSettings: invokeVoid<AiProviderSettings>(),
  /** The same snapshot, pushed when it changed WITHOUT a client asking — the
   * OAuth round-trip finishing on the host's callback, which is a different
   * tab. Paired with the getter in HYDRATED_EVENTS, so a reconnect lands on
   * the truth rather than on whatever the last mutating call returned. */
  onAiProviderChanged: event<AiProviderSettings>(),
  /** Patch the selection (partial; a provider switch defaults the model).
   * Rolls the live sessions so the next turn runs the new provider+model. */
  setAiProviderConfig: invoke<typeof AiProviderSetConfigSchema, AiProviderSettings>(
    AiProviderSetConfigSchema,
  ),
  /** START the OAuth connect flow for one provider. The host parks a PKCE
   * verifier and answers with the provider's consent URL; the CLIENT must send
   * the user there, and the connection completes on the host's own OAuth
   * callback, arriving back as `onAiProviderChanged`. */
  connectAiProvider: invoke<typeof AiProviderRefSchema, AiConnectResult>(AiProviderRefSchema),
  /** Drop the host's sealed credential for one provider. */
  disconnectAiProvider: invoke<typeof AiProviderRefSchema, AiProviderSettings>(AiProviderRefSchema),

  // Voice
  isTtsAvailable: invokeVoid<boolean>(),
  /** Store/clear the ElevenLabs API key. Voice owns its secret: the handler
   * writes the encrypted secret store directly and keeps only a `true`
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

  // UI state
  getUiState: invokeVoid<Record<string, unknown>>(),
  setUiState: invoke<typeof UiStateSetSchema, void>(UiStateSetSchema),

  // Vault — the user's folder of markdown.
  /** The whole first paint in one round trip (see WorkspaceBoot). */
  getWorkspaceBoot: invokeVoid<WorkspaceBoot>(),
  listVault: invokeVoid<VaultEntry[]>(),
  readVaultFile: invoke<typeof VaultPathSchema, string>(VaultPathSchema),
  /** Size + last-modified for one vault file, or null when it cannot be
   * described. Its own channel rather than a fatter `listVault`: the listing
   * carries neither (see VaultFileFacts). */
  getVaultFileFacts: invoke<typeof VaultPathSchema, VaultFileFacts | null>(VaultPathSchema),
  writeVaultFile: invoke<typeof VaultWriteFileSchema, void>(VaultWriteFileSchema),
  /** Trash one vault entry. A tombstone, not a removal — and subject to the
   * deletion gate, whose hold is its own outcome rather than an error. */
  deleteVaultEntry: invoke<typeof VaultPathSchema, DeleteVaultEntryResult>(VaultPathSchema),
  /** Rename/move a file to a new vault-relative path. Refuses to clobber an
   * existing file. */
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
  /** Re-announce the manifest now. The broadcast it fires names no paths, so
   * every client re-reads — the "Refresh vault" command's whole meaning. */
  refreshVault: invokeVoid<void>(),
  /** Fired on every vault change so the sidebar re-lists and the editor
   * reloads — carrying WHICH paths moved, so a client re-reads only what it
   * has to. */
  onVaultChanged: event<VaultChangedEvent>(),

  // Knowledge — link + search indexes over the vault, projected on every write.
  // Queries are cheap index reads.
  getBacklinks: invoke<typeof NotePathSchema, BacklinkEntry[]>(NotePathSchema),
  getForwardLinks: invoke<typeof NotePathSchema, ForwardLinkEntry[]>(NotePathSchema),
  /** Vault link graph, shaped for a force-graph renderer (unresolved targets
   * appear as flagged phantom nodes). The caller's bounds are applied HOST-side,
   * before serialization — the whole graph is ~42MB of JSON at 50k notes, so a
   * client-side filter would save nothing that matters. The reply always
   * carries the whole graph's counts, so a bounded view can say how much of the
   * vault it is showing. */
  getLinkGraph: invoke<typeof LinkGraphBoundsSchema, BoundedLinkGraph>(LinkGraphBoundsSchema),
  /** Ranked lexical full-text search (title > heading > body tiers), optionally
   * narrowed to one tag — the palette's `tag:` filter and the agent's
   * `search_vault` tag argument are the same composition. */
  searchVault: invoke<typeof KnowledgeSearchSchema, SearchResult[]>(KnowledgeSearchSchema),
  /** Every linkable target for the `[[`-autocomplete picker: notes first,
   * then attachments (flagged `type: "asset"` so the picker groups them and
   * inserts `![[embeds]]`). */
  listWikiTargets: invokeVoid<WikiTarget[]>(),
  /** Every task in the vault (checked and not), path-then-ordinal — the Tasks
   * view's whole-vault query over the projection. */
  listVaultTasks: invokeVoid<VaultTaskEntry[]>(),
  /** Guarded checkbox toggle: re-read the file, locate the ordinal-th task
   * item, require its current line to equal `expectedRaw` byte-for-byte, and
   * flip only the marker char. On ANY {ok:false} the host refreshes the index
   * (self-heal) and the client refetches + toasts — refuse loudly, never write
   * wrong. Invalidation rides the existing onKnowledgeUpdated event. */
  toggleVaultTask: invoke<typeof ToggleTaskSchema, ToggleTaskResult>(ToggleTaskSchema),
  /** Fired after every index refresh so backlink panes / graph views
   * re-query. */
  onKnowledgeUpdated: event<Record<string, never>>(),

  // Delegation — a checkbox handed to the background lane.
  createDelegation: invoke<typeof CreateDelegationParamsSchema, CreateDelegationResult>(
    CreateDelegationParamsSchema,
  ),
  listDelegations: invokeVoid<ListDelegationsResult>(),
  cancelDelegation: invoke<TString, { ok: boolean }>(Type.String({ minLength: 1 })),
  /** Restore the target file's pre-run bytes (captured before the background
   * agent dispatched). Writes through the vault, so the standard onVaultChanged
   * refreshes editors; no-op success when the file already matches the
   * snapshot. Records `restoredAt` on the delegation. */
  restoreDelegationSnapshot: invoke<TString, RestoreSnapshotResult>(Type.String({ minLength: 1 })),
  /** Fired on every delegation status change so the editor's inline badges
   * stay live. */
  onDelegationsUpdated: event<ListDelegationsResult>(),
  /** Fired as a running delegation streams its response text (accumulating,
   * keyed by id) so the response dock can show it live. */
  onDelegationStreamed: event<{ id: string; text: string }>(),

  // Routines — scheduled agent tasks (delegation's sibling: the same background
  // lane, serialized with it; results append to a target note).
  listRoutines: invokeVoid<ListRoutinesResult>(),
  /** Create (no id) or edit (with id) a routine's config; run bookkeeping is
   * host-owned. */
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

  // Agent writes — the restore point behind them and the confirmation in front
  // of the destructive ones (see ./agent-actions).
  /** A chat-agent write was checkpointed pre-execution — drives the
   * post-turn undo toast. */
  onAgentEditCaptured: event<AgentEditCaptured>(),
  /** Undo a set of chat checkpoints: each `edit` writes its pre-write bytes
   * back through the vault (no-op when already matching; onVaultChanged
   * refreshes editors), each `create` tombstones the created file. The client
   * flushes the open note FIRST so the restore never fights a dirty buffer. */
  restoreAgentEdits: invoke<typeof RestoreAgentEditsSchema, RestoreAgentEditsResult>(
    RestoreAgentEditsSchema,
  ),
  /** The agent proposes a destructive action and is waiting on the user.
   * Exactly one reply per `id` is expected; a request the UI never answers
   * expires host-side as a decline (fail-closed), so a dropped event or a
   * closed window can never leave the action pending forever. */
  onAgentConfirmationRequested: event<AgentConfirmationRequest>(),
  /** The user's answer. Unknown or already-answered ids are ignored — the
   * host owns expiry, and a late reply must not resurrect a settled
   * proposal. */
  resolveAgentConfirmation: invoke<typeof AgentConfirmationReplySchema, void>(
    AgentConfirmationReplySchema,
  ),

  // Deep-link capture — inteligir://append|task landing on today's daily note.
  /** A capture targets the open note: apply `line` through the live editor
   * buffer so the next autosave persists it. */
  onCaptureApply: event<CaptureApplyEvent>(),
  /** The client's capture-apply verdict — see AckCaptureSchema. */
  ackCapture: invoke<typeof AckCaptureSchema, void>(AckCaptureSchema),
  /** A deep-link nav verb arrived (inteligir://today | note/<target> |
   * search?q=). Id-stamped so a client can dedupe the cold-launch
   * overlap between this push and the takePendingDeepLinkNav pull. */
  onDeepLinkNav: event<DeepLinkNavEvent>(),
  /** Pull-and-clear the parked nav on mount — a cold launch delivers the URL
   * before any client subscribed. Callers MUST subscribe onDeepLinkNav BEFORE
   * pulling (the reverse order silently drops a nav landing between the two)
   * and dedupe by event id. */
  takePendingDeepLinkNav: invokeVoid<DeepLinkNavEvent | null>(),

  // Inline AI — one-shot text generation for the editor's AI menu (generate
  // and edit flows), run as a direct provider call with no tools.
  generateInlineAi: invoke<typeof AiGenerateParamsSchema, AiGenerateResult>(AiGenerateParamsSchema),
  /** Fired for each text delta of an in-flight inline-AI request (keyed by the
   * caller's requestId) so the editor can insert the generation live. */
  onAiStreamed: event<{ requestId: string; delta: string }>(),
  /** Abort an in-flight generateInlineAi turn (Escape mid-stream). */
  cancelInlineAi: invoke<typeof AiCancelParamsSchema, void>(AiCancelParamsSchema),
  /** Classify a free-form AI-menu prompt as generate vs edit intent.
   * Unparseable answers fall back to generate. */
  classifyAiIntent: invoke<typeof AiIntentParamsSchema, AiIntentResult>(AiIntentParamsSchema),
  /** One ghost-text completion on the dedicated fast lane. A new request
   * supersedes (aborts) the previous one. */
  generateGhostText: invoke<typeof GhostTextParamsSchema, GhostTextResult>(GhostTextParamsSchema),
  /** Abort an in-flight ghost completion (typing / Escape / blur). */
  cancelGhostText: invoke<typeof AiCancelParamsSchema, void>(AiCancelParamsSchema),
  /** Models the ghost-text lane can run (for the settings picker). */
  listGhostModels: invokeVoid<GhostModelsResult>(),

  // Skills
  listSkills: invokeVoid<SkillsList>(),
  /** Scaffold a new skill: `skills/<slug>/SKILL.md` in the vault with valid
   * frontmatter, where <slug> is derived host-side from `name`. The agent
   * picks it up on its next start. Rejects when the slug is empty or already
   * taken — never overwrites an existing skill. */
  createSkill: invoke<typeof CreateSkillSchema, SkillCreated>(CreateSkillSchema),
} as const satisfies Record<string, IpcEntry>;

/** Every method name on the wire. */
export type IpcMethod = keyof typeof IPC;

// Object.keys returns string[]; the predicate re-proves membership so the
// typed list needs no assertion.
function methodNames<T extends Record<string, IpcEntry>>(registry: T): Array<keyof T & string> {
  return Object.keys(registry).filter((key): key is keyof T & string =>
    Object.hasOwn(registry, key),
  );
}

/** The same table as a runtime list (for folds and completeness checks). */
export const IPC_METHODS: IpcMethod[] = methodNames(IPC);
