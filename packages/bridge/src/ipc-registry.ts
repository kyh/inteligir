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
  BoundedLinkGraph,
  ForwardLinkEntry,
  VaultTaskEntry,
  WikiTarget,
} from "@repo/notes/knowledge/link-graph-index";
import {
  UpsertRoutineParamsSchema,
  type ListRoutinesResult,
  type RunRoutineNowResult,
  type UpsertRoutineResult,
} from "./routines";
import { UiStateSetSchema } from "./ui-state";
import { TextChatMessageSchema } from "./chat-message";

// ---------------------------------------------------------------------------
// Shared shapes referenced by registry entries
// ---------------------------------------------------------------------------

export type SetupProgress = {
  step: string;
  percent: number | null;
};

export type NotificationSettings = {
  enabled: boolean;
};

/** How widely a skill applies. Skills live in the vault, so every one of them
 * is the user's own and this host only ever answers `user`. */
export type SkillScope = "user" | "project" | "temporary";

/** Where a skill came from, as far as the app can honestly tell. There is no
 * publisher or author concept here: "added" means someone put the folder in
 * the vault (the user, or an agent). Nothing is shipped into a vault after the
 * seed, so this host only ever answers `added`. */
export type SkillSource = "bundled" | "added";

/** What the agent's system prompt actually received for a skill.
 *
 * The listing budget sheds description CHARACTERS before it sheds skills — a
 * skill the model knows by name alone is still invocable, a skill missing from
 * the listing is not — so `description-trimmed` is the routine outcome and
 * `not-loaded` is the backstop for a pathological skills folder. */
export type SkillBudgetState =
  /** Whole description reached the prompt. */
  | { kind: "loaded" }
  /** Name reached the prompt; the description was clipped to `promptChars`. */
  | { kind: "description-trimmed"; promptChars: number; originalChars: number }
  /** Nothing reached the prompt — the agent cannot invoke this skill. */
  | { kind: "not-loaded"; reason: "skill-count" };

/** One `skills/<slug>/SKILL.md` in the vault, as the listing reports it. */
export type SkillInfo = {
  name: string;
  /** The description as the prompt received it — already clamped by the
   * budget. `budget` says whether that is all of what is on disk. */
  description: string;
  scope: SkillScope;
  filePath: string;
  source: SkillSource;
  /** SKILL.md mtime as epoch MILLISECONDS, or null when it can't be stat'd.
   * A number on purpose: formatting a date is the renderer's job and the wire
   * stays locale-free. */
  updatedAt: number | null;
  budget: SkillBudgetState;
};

export type SkillsList = {
  skills: SkillInfo[];
};

/** Result of createSkill: the skill that was just written, plus the refreshed
 * listing so the caller needs no follow-up round trip. */
export type SkillCreated = {
  skill: SkillInfo;
  skills: SkillInfo[];
};

// `name` is a display name, not a path — the host slugifies it and refuses
// anything that doesn't reduce to a `[a-z0-9-]` folder name, so no traversal
// can cross this schema. `description` is capped at the Agent Skills
// description limit — a description written over the cap would be clipped
// back out on the very next listing.
const CreateSkillSchema = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 64 }),
    description: Type.String({ minLength: 1, maxLength: 1536 }),
    /** SKILL.md body — the instructions themselves. Empty gets a placeholder
     * body, so a caller can scaffold first and write later. */
    instructions: Type.String({ maxLength: 100_000 }),
  },
  { additionalProperties: false },
);

const NotificationsPatchSchema = Type.Object(
  { enabled: Type.Optional(Type.Boolean()) },
  { additionalProperties: false },
);

// Dev-only scripted-agent responses: one step per assistant turn — optional
// text plus optional tool calls (e.g. the write-back a delegation performs),
// answered by the in-memory container. The handler throws unless
// AGENT_RUNTIME=scripted, so the channel never does anything in production.
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

/** A destructive action the agent has proposed, awaiting a human answer. The
 * host composes every field from its own state — a proposal never carries
 * model-authored prose, so a note's contents cannot write the dialog the user
 * is about to agree to. */
export type AgentConfirmationRequest = {
  id: string;
  /** The action and its target, as one question. */
  title: string;
  /** What confirming does, in the app's own words. */
  detail: string;
  confirmLabel: string;
};

const AgentConfirmationReplySchema = Type.Object(
  { id: Type.String({ minLength: 1 }), confirmed: Type.Boolean() },
  { additionalProperties: false },
);

// ---------------------------------------------------------------------------
// Vault — the user's local knowledge folder (markdown). Paths are
// vault-relative; main confines them under the vault root.
// ---------------------------------------------------------------------------

/** A vault-relative path to ONE markdown note — the unit the knowledge queries
 * and the privacy probe are asked about. Exported: the agent's knowledge tools
 * take this exact argument and hand the schema to a model, so the prose that
 * tells the model what a valid path looks like lives HERE, once, instead of
 * being restated per tool (agent/knowledge-tools/extension.ts). */
export const NotePathSchema = Type.Object(
  {
    path: Type.String({
      description:
        "Path to a markdown note, relative to the vault root — e.g. 'notes/ideas.md'. " +
        "Never absolute, never escaping the vault.",
    }),
  },
  { additionalProperties: false },
);

/** A vault-relative path to ONE file of any kind — a note, an image, an HTML
 * app. Deliberately not `NotePathSchema`: these channels read/stat/trash
 * whatever the path names, so promising a model (or a reader) "a note" would
 * be a narrower contract than the handler behind it. */
const VaultPathSchema = Type.Object(
  {
    path: Type.String({
      description:
        "Path to a single file — note or attachment — relative to the vault root, " +
        "e.g. 'assets/diagram.png'. Names a file, never a folder.",
    }),
  },
  { additionalProperties: false },
);
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

/** The on-disk facts about ONE vault file that the listing deliberately does
 * not carry. `VaultEntry` is produced by a stat-free crawl (a stat per file is
 * the largest cost in a large vault), so size and mtime are a separate,
 * per-file question — asked about the note a user is looking at, never swept.
 * `null` when the file can't be stat'd (missing, escaping the vault). */
export type VaultFileFacts = { sizeBytes: number; modifiedMs: number };

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

/** The deletion gate's refusal, in the terms a human is asked to confirm. */
export type HeldDeletions = {
  /** How many deletions this call would bring the window to. */
  readonly deletions: number;
  /** Files the vault holds right now, for "N of M" phrasing. */
  readonly liveCount: number;
  /** The count above which the gate holds. */
  readonly limit: number;
  /** A few of the paths this call would remove. */
  readonly sample: readonly string[];
};

/**
 * What a delete did.
 *
 * THREE outcomes, not a boolean, because the gate holding is a third thing:
 * `absent` says the path named no live file, and answering a HELD delete with
 * it would report a file the user can still see as gone. A caller that shows a
 * row must be able to tell "it went", "it was never there" and "the host
 * refused, here is why" apart.
 */
export type DeleteVaultEntryResult =
  | { readonly outcome: "trashed" }
  | { readonly outcome: "absent" }
  | { readonly outcome: "held"; readonly held: HeldDeletions };

/** The sentence a held deletion is reported with — one phrasing, so the refusal
 * reads the same in a toast, in an agent tool's failure and in a log. */
export function heldDeletionMessage(held: HeldDeletions): string {
  const named = held.sample.map((path) => `"${path}"`).join(", ");
  return (
    `Refusing to delete ${held.deletions} file(s) of ${held.liveCount} without confirmation ` +
    `(${named}${held.sample.length < held.deletions ? ", …" : ""}). ` +
    "Confirm the deletion to proceed."
  );
}

// ---------------------------------------------------------------------------
// Knowledge — the host's link + lexical search indexes over the vault
// (backlinks, graph, palette search, wiki autocomplete). Result shapes live
// in @repo/notes/knowledge next to the engine that produces them
// (link-graph-index, tag-index, knowledge-index).
// ---------------------------------------------------------------------------

const KnowledgeSearchSchema = Type.Object(
  {
    query: Type.String(),
    /** Restrict to notes carrying this tag. Empty or absent means no filter,
     * so an empty `query` with a `tag` lists that tag's notes. */
    tag: Type.Optional(Type.String()),
    limit: Type.Optional(Type.Number({ minimum: 1, maximum: 200 })),
  },
  { additionalProperties: false },
);

// How much of the link graph to return — the wire face of @repo/notes'
// GraphBounds. Every field optional: `{}` asks for the whole vault, which is
// what a small one still answers.
const LinkGraphBoundsSchema = Type.Object(
  {
    /** Vault path whose neighbourhood is expanded first (typically the open note). */
    focus: Type.Optional(Type.String()),
    maxNodes: Type.Optional(Type.Number({ minimum: 1 })),
    maxEdges: Type.Optional(Type.Number({ minimum: 0 })),
  },
  { additionalProperties: false },
);

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
  /** Dev-only (AGENT_RUNTIME=scripted; throws otherwise): replace the scripted
   * container's queued responses so a headless E2E drive scripts exact agent
   * turns. One step is consumed per assistant turn, and BOTH lanes share one
   * queue (chat + background — script, then drive exactly one flow). Empty
   * `steps` restores the self-refilling echo. */
  setFauxAgentScript: invoke<typeof FauxAgentScriptSchema, void>(FauxAgentScriptSchema),
  /** Dev-only (AGENT_RUNTIME=scripted; throws otherwise): the chat session's
   * composed system prompt, or null before the agent starts. Lets a headless
   * E2E drive assert injected context (e.g. vault/AGENTS.md instructions)
   * actually reached the constructed session. */
  getAgentSystemPrompt: invokeVoid<string | null>(),

  // AI provider — WHICH provider+model the agent surfaces run on. These
  // channels move only the SELECTION and per-provider connected booleans; the
  // credential is sealed in the host object and never crosses the Bridge.
  /** Selection + every offered provider with connected state and model menu. */
  getAiProviderSettings: invokeVoid<AiProviderSettings>(),
  /** Patch the selection (partial; a provider switch defaults the model).
   * Rolls the live sessions so the next turn runs the new provider+model. */
  setAiProviderConfig: invoke<typeof AiProviderSetConfigSchema, AiProviderSettings>(
    AiProviderSetConfigSchema,
  ),
  /** Run the interactive OAuth connect flow for one provider (opens the
   * host cannot open one, `authorizeUrl` comes back for the client to send
   * the user to and the connection completes on the host's OAuth callback). */
  connectAiProvider: invoke<typeof AiProviderRefSchema, AiConnectResult>(AiProviderRefSchema),
  /** Drop the host's sealed credential for one provider. */
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
  listVault: invokeVoid<VaultEntry[]>(),
  readVaultDoc: invoke<typeof VaultPathSchema, string>(VaultPathSchema),
  /** Size + last-modified for one vault file, or null when it can't be stat'd.
   * Its own channel rather than a fatter `listVault`: the crawl behind the
   * listing never stats (see VaultFileFacts). */
  getVaultFileFacts: invoke<typeof VaultPathSchema, VaultFileFacts | null>(VaultPathSchema),
  writeVaultDoc: invoke<typeof VaultWriteDocSchema, void>(VaultWriteDocSchema),
  /** Trash one vault entry. A tombstone, not a removal — and subject to the
   * deletion gate, whose hold is its own outcome rather than an error. */
  deleteVaultEntry: invoke<typeof VaultPathSchema, DeleteVaultEntryResult>(VaultPathSchema),
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
  /** Re-read the vault listing now: re-list + reindex. The client calls this
   * on window focus (debounced) and from the "Refresh vault" command; the host
   * also calls it internally on background-work completion. */
  refreshVault: invokeVoid<void>(),
  /** Fired on every vault change (file edit by anyone, or a root switch) so the
   * sidebar re-lists and the editor reloads. */
  onVaultChanged: event<{ root: string }>(),

  // Knowledge — link + search indexes over the vault, kept fresh from vault
  // change events. Queries are cheap index reads.
  getBacklinks: invoke<typeof NotePathSchema, BacklinkEntry[]>(NotePathSchema),
  getForwardLinks: invoke<typeof NotePathSchema, ForwardLinkEntry[]>(NotePathSchema),
  /** Vault link graph, shaped for a force-graph renderer (unresolved targets
   * appear as flagged phantom nodes). The caller's bounds are applied HOST-side,
   * before serialization — the whole graph is ~42MB of JSON at 50k notes, so a
   * renderer-side filter would save nothing that matters. The reply always
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
  /** Vault paths of the notes carrying a tag (case-insensitive). */
  /** Every task in the vault (checked and not), path-then-ordinal — the Tasks
   * view's whole-vault query over the projection. */
  listVaultTasks: invokeVoid<VaultTaskEntry[]>(),
  /** Guarded checkbox toggle: re-read the file, locate the ordinal-th task
   * item, require its current line to equal `expectedRaw` byte-for-byte, and
   * flip only the marker char (atomic write; the host broadcasts). On ANY
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
   * agent dispatched). Writes atomically through the vault, so the standard
   * onVaultChanged refreshes editors; no-op success when the file already
   * matches the snapshot. Records `restoredAt` on the delegation. */
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
   * back atomically through the vault (no-op when already matching;
   * onVaultChanged refreshes editors), each `create` tombstones the created
   * file. The client flushes the open note FIRST so the restore never fights
   * a dirty buffer. */
  restoreAgentEdits: invoke<typeof RestoreAgentEditsSchema, RestoreAgentEditsResult>(
    RestoreAgentEditsSchema,
  ),

  // Agent confirmations — the destructive-confirmed tier of the grant table
  // (agent-grants.ts). The host raises the request from inside the action
  // port, so a tool cannot skip it; the answer travels back on the reply
  // channel and the port resolves to a plain declined VALUE on "no".
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

  // Skills
  listSkills: invokeVoid<SkillsList>(),
  /** Scaffold a new skill: `<agentDir>/skills/<slug>/SKILL.md` with valid
   * frontmatter, where <slug> is derived host-side from `name`. The agent
   * picks it up on its next start. Rejects when the slug is empty or already
   * taken — never overwrites an existing skill. */
  createSkill: invoke<typeof CreateSkillSchema, SkillCreated>(CreateSkillSchema),
} as const satisfies Record<string, IpcEntry>;

type IpcRegistry = typeof IPC;
export type IpcMethod = keyof IpcRegistry;

// ---------------------------------------------------------------------------
// Method partitions — hosts and transports slice the registry along one line:
// events are host → UI pushes with no handler, everything else is a host-owned
// handler.
// ---------------------------------------------------------------------------

/** Host → UI push channels. */
export type EventMethod = {
  [K in IpcMethod]: IpcRegistry[K] extends { kind: "event" } ? K : never;
}[IpcMethod];

// ---------------------------------------------------------------------------
// Client-class capability allowlists.
//
// A companion app is NOT the workspace: it holds the same account, but on a
// device with a much larger loss surface, so it reaches only the narrow
// companion surface.
//
// These are ALLOWLISTS, not blocklists, and that direction is the point: a new
// channel is unreachable from a companion client until someone adds it here on
// purpose. A blocklist would silently expose every channel written after it,
// including `deleteVaultEntry`, `connectAiProvider` and `setVoiceApiKey`.
//
// The host enforces all three of these per-socket: invoke/send at dispatch,
// events at broadcast, and the reconnect hydration push (which resolves through
// the same dispatch map and would otherwise hand a companion the state of a
// getter it is forbidden to call).
// ---------------------------------------------------------------------------

// The AGENT's capability policy is NOT here: it is agent-grants.ts, a table of
// rows rather than a list of names. A companion client reaches these handlers
// unmodified, so naming them is a complete policy; the agent reaches
// privacy-projecting ports instead, so a name says nothing about what it can
// see. Never grant the agent a capability by adding a method here.

/** The ONLY methods a companion client may invoke. Everything else — the whole
 * vault/knowledge/settings/provider surface — is workspace-only. A companion
 * drives chat + the delegation dock and nothing else. */
export const REMOTE_ALLOWED_METHODS = [
  "getAgentHistory",
  "sendAgentCommand",
  "listDelegations",
  "cancelDelegation",
  "restoreDelegationSnapshot",
] as const satisfies readonly IpcMethod[];

/** The ONLY events pushed to a companion client, at broadcast AND at reconnect
 * hydration. Notably excluded: `onTtsAudio` (spoken note content as raw
 * PCM). */
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

const BINARY_CHANNELS = [
  { method: "sendSttAudio", tag: 1 },
  { method: "onTtsAudio", tag: 2, field: "audio" },
] as const satisfies readonly { method: IpcMethod; tag: number; field?: string }[];

type BinaryChannel = (typeof BINARY_CHANNELS)[number];

/** Binary-channel descriptor for `method`, or undefined for a JSON channel. */
export function binaryChannelFor(method: string): BinaryChannel | undefined {
  return BINARY_CHANNELS.find((channel) => channel.method === method);
}

/** Binary-channel descriptor for a received frame's tag. */
export function binaryChannelForTag(tag: number): BinaryChannel | undefined {
  return BINARY_CHANNELS.find((channel) => channel.tag === tag);
}

/** Methods the host implements. */
export type HostMethod = Exclude<IpcMethod, EventMethod>;

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
 * is deliberately not provided). Getters resolve through the same class gate as
 * an ordinary call, so hydration can never volunteer state a client is
 * forbidden to ask for; a getter this host does not answer skips its push. */
export const HYDRATED_EVENTS = {
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
 * registry; the ws bridge and the workspace's fixture Bridge both implement
 * it. */
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
