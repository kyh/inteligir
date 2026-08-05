// ---------------------------------------------------------------------------
// The agent grant table — everything the LOCAL agent may do to the vault and
// to host state, and everything it may not.
//
// Its sibling is REMOTE_ALLOWED_METHODS (ipc-registry.ts), and the difference
// in SHAPE is the whole point. A paired remote device reaches the identical
// handler the renderer reaches: the same code, a narrower list of names, so an
// allowlist of names is a complete policy. The agent cannot. Those handlers are
// privacy-BLIND on purpose — the user looking at their own vault must see every
// note, including `private: true` ones — so a capability generated from a window
// handler would read private notes silently. Every row below is therefore
// implemented over the projecting AgentPorts (boot/agent-knowledge-port.ts,
// boot/agent-action-port.ts), which filter at the index AND re-probe every
// survivor against live disk. A row's `capability` NAMES the bridge method for
// traceability; it never means the tool calls it.
//
// Rows carry a `description` written for a MODEL: what the capability does,
// what it costs, what it refuses. The TSDoc on the registry entries is written
// for maintainers ("Desktop-shell-only, same reasoning as mintHtmlAppToken")
// and would mislead one — do not copy it here.
//
// The never-granted rows are DECLARED rather than merely absent, grouped by
// reason. "The agent can't do that" arriving as silence — an invented tool
// name, a model insisting it has no way to help — is exactly the confusion this
// table exists to end.
//
// POLICY, NOT ENFORCEMENT. There is no agent filesystem sandbox and there never
// will be (CLAUDE.md § Decisions): `bash`, `execute`, `browser` and `peekaboo`
// have real machine access, which is the product. So `never-granted` is a
// statement about what the ACTION LAYER exposes, not a boundary — a model with
// a shell reads `~/.inteligir` directly. And `destructive-confirmed` is a
// prompt for the human, not a gate — the peekaboo bundle can click it. Both
// govern what the agent does deliberately. Describe them that way.
//
// Events are absent by construction: they are host → UI pushes, and a tool is a
// request/response with no subscriber to be. The partition below therefore
// covers exactly the non-event methods.
// ---------------------------------------------------------------------------

import type { IpcMethod } from "./ipc-registry";

/** Capabilities with no bridge twin: the knowledge index answers them and no
 * window has ever asked, so there is no method to name after. */
export const KNOWLEDGE_ONLY_CAPABILITIES = ["listTags", "relatedNotes"] as const;

export type AgentCapability = IpcMethod | (typeof KNOWLEDGE_ONLY_CAPABILITIES)[number];

/**
 * - `read-projected` — reads that pass through a privacy projection: private
 *   notes are excluded at the index and every surviving path is re-probed
 *   against live disk before it is emitted. Drops are SILENT, so an omission
 *   never confirms that a guessed path exists.
 * - `write-checkpointed` — a mutation the agent's own file tools cannot
 *   express. Both members capture a restore point (or are their own inverse)
 *   before touching disk, fail-closed: no undo point, no write.
 * - `delegate` — handing work to the background agent, and un-handing it.
 *   Creates no vault bytes itself; the run it queues is checkpointed by the
 *   delegation manager's own pre-run snapshot.
 * - `destructive-confirmed` — the model PROPOSES and a human answers in the
 *   conversation. The confirmation is raised host-side inside the port, so a
 *   tool cannot forget to ask; a decline comes back as an ordinary value.
 */
export type AgentGrantTier =
  | "read-projected"
  | "write-checkpointed"
  | "delegate"
  | "destructive-confirmed";

export type AgentGrant = {
  /** The bridge method this capability is named after — traceability only. */
  capability: AgentCapability;
  /** The tool name the model sees. */
  agentName: string;
  tier: AgentGrantTier;
  /** Written for a model, not for a maintainer. */
  description: string;
};

export const AGENT_GRANTS: readonly AgentGrant[] = [
  // ---- read-projected ------------------------------------------------------
  {
    capability: "searchVault",
    agentName: "search_vault",
    tier: "read-projected",
    description:
      "Full-text search over the user's notes, ranked, optionally narrowed to one tag. " +
      "Use it instead of grep to find notes by topic; grep sees bytes, this sees the index.",
  },
  {
    capability: "getBacklinks",
    agentName: "get_backlinks",
    tier: "read-projected",
    description:
      "The notes that link TO one note. Answers 'what refers to this?' — a question no " +
      "amount of reading the note itself can answer.",
  },
  {
    capability: "getForwardLinks",
    agentName: "get_links",
    tier: "read-projected",
    description:
      "The links a note points OUT to, resolved to the files they land on. Reading the note " +
      "shows you the link TEXT; only the index knows which file `[[Some Name]]` means. Links " +
      "with no note behind them come back marked unresolved rather than dropped.",
  },
  {
    capability: "relatedNotes",
    agentName: "related_notes",
    tier: "read-projected",
    description:
      "Notes connected to one note INDIRECTLY — shared link targets, co-citation, shared " +
      "tags, similar wording — ranked, each with its reason. Directly linked notes are " +
      "excluded; get_links and get_backlinks cover those.",
  },
  {
    capability: "listVault",
    agentName: "list_vault",
    tier: "read-projected",
    description:
      "One bounded, alphabetical page of the vault's files, optionally under one folder. " +
      "A page can come back shorter than you asked for; that is normal and means nothing " +
      "about what else exists. Prefer search_vault when you know what you are looking for.",
  },
  {
    capability: "readVaultDoc",
    agentName: "read_note",
    tier: "read-projected",
    description:
      "One note's full markdown text, or nothing at all when it is missing, is not a note, " +
      "or is too large to hand over. Every note you read is re-sent with every later turn, " +
      "so read what you need and not the vault.",
  },
  {
    capability: "getVaultFileFacts",
    agentName: "get_note_facts",
    tier: "read-projected",
    description:
      "One file's size and last-modified time, without reading its contents. Use it to tell " +
      "whether a note changed or how big it is before deciding to read it.",
  },
  {
    capability: "listVaultTasks",
    agentName: "list_tasks",
    tier: "read-projected",
    description:
      "One bounded page of the vault's `- [ ]` checkboxes, each with the note it lives in, " +
      "its exact source line, and the ordinal that toggle_task and delegate_task key on. " +
      "Carry both values through unchanged — retyping the line makes the write refuse.",
  },
  {
    capability: "listTags",
    agentName: "list_tags",
    tier: "read-projected",
    description:
      "Every tag in the vault with how many notes carry it, most-used first. Counts describe " +
      "the notes you can see. EXPENSIVE: it reads the whole vault. Call it once to orient " +
      "yourself, never in a loop.",
  },
  {
    capability: "listWikiTargets",
    agentName: "list_wiki_targets",
    tier: "read-projected",
    description:
      "One bounded page of the names `[[wiki-links]]` can resolve to — note titles, their " +
      "aliases, and attachments. Check a name here before writing a link, so you link to a " +
      "note that exists instead of creating a dangling one.",
  },
  {
    capability: "getLinkGraph",
    agentName: "get_link_graph",
    tier: "read-projected",
    description:
      "A summary of the vault's link structure: totals, the notes nothing links to or from, " +
      "the most-connected notes, and the connected clusters. The lists are samples, not " +
      "complete enumerations. EXPENSIVE: it reads the whole vault. Call it once, never in a loop.",
  },
  {
    capability: "getSyncState",
    agentName: "get_sync_state",
    tier: "read-projected",
    description:
      "Whether vault sync is on and how the last pass went, plus any unresolved conflict " +
      "copies. Sync is off by default. You cannot start, stop or configure it — if a pass is " +
      "held or failing, say so and let the user act.",
  },
  {
    capability: "listDelegations",
    agentName: "list_delegations",
    tier: "read-projected",
    description:
      "The background tasks the user (or you) handed off: which note and line each came " +
      "from, its status, and its one-line result. Check here before delegating the same " +
      "checkbox twice.",
  },

  // ---- write-checkpointed --------------------------------------------------
  {
    capability: "toggleVaultTask",
    agentName: "toggle_task",
    tier: "write-checkpointed",
    description:
      "Tick or untick one `- [ ]` checkbox, keyed by the ordinal AND the exact source line " +
      "list_tasks gave you. It refuses rather than guess when the line has changed since — " +
      "re-read the tasks and try again; never edit the file to force it.",
  },
  {
    capability: "renameVaultEntry",
    agentName: "rename_note",
    tier: "write-checkpointed",
    description:
      "Rename or move a note, rewriting every link that pointed at it across the whole vault " +
      "and recording the old title as an alias so stale references still resolve. ALWAYS " +
      "rename this way — `bash mv`, or writing a new file and deleting the old one, dangles " +
      "every inbound link silently.",
  },

  // ---- delegate ------------------------------------------------------------
  {
    capability: "createDelegation",
    agentName: "delegate_task",
    tier: "delegate",
    description:
      "Hand one checkbox to the background agent: it does the task, ticks the box and writes " +
      "the result under it. Use it for work that would outlast this conversation, not for " +
      "something you can do now. It runs unattended, so the user will not be watching.",
  },
  {
    capability: "cancelDelegation",
    agentName: "cancel_delegation",
    tier: "delegate",
    description:
      "Stop a queued or running background task. Work it already wrote to the note stays — " +
      "cancelling is not undoing.",
  },
  {
    capability: "restoreDelegationSnapshot",
    agentName: "restore_delegation",
    tier: "delegate",
    description:
      "Put the note a finished background task edited back exactly as it was before that " +
      "task ran. Only that one task's changes are reverted, and only while it is not running.",
  },

  // ---- destructive-confirmed -----------------------------------------------
  {
    capability: "deleteVaultEntry",
    agentName: "delete_note",
    tier: "destructive-confirmed",
    description:
      "Propose moving a file to the system trash. The user is asked first and may say no, " +
      "which comes back as an ordinary result — do not retry it, and do not reach for `bash " +
      "rm` instead. Recoverable from the trash, but the user's own decision either way.",
  },
  {
    capability: "restoreAgentEdits",
    agentName: "undo_my_edits",
    tier: "destructive-confirmed",
    description:
      "Propose undoing YOUR most recent edit to one note, restoring the bytes from just " +
      "before it. Destructive because anything written since — by you or by the user — goes " +
      "with it. The user is asked first and may say no.",
  },
];

/**
 * - `needs-a-human-at-a-screen` — the action only means anything when a person
 *   is present to see or answer it.
 * - `recursive` — driving the agent itself.
 * - `configuration` — the user's settings and the status reads over them.
 * - `already-in-the-file-tools` — the same effect already reaches the agent
 *   through a path that is gated and captured.
 */
export type AgentDenialReason =
  | "needs-a-human-at-a-screen"
  | "recursive"
  | "configuration"
  | "already-in-the-file-tools";

export type AgentDenialGroup = {
  reason: AgentDenialReason;
  /** Also written for a model — it is the answer to "why can't I?". */
  why: string;
  capabilities: readonly IpcMethod[];
};

export const AGENT_NEVER_GRANTED: readonly AgentDenialGroup[] = [
  {
    reason: "needs-a-human-at-a-screen",
    why:
      "These open a dialog, a browser, a microphone, a speaker, or the window the user is " +
      "looking at. A person has to be there for the action to mean anything, and a person " +
      "who is there does not need you to do it for them. Ask the user to do it and say where.",
    capabilities: [
      "transition",
      "reauthenticate",
      "connectAiProvider",
      "disconnectAiProvider",
      "chooseVaultRoot",
      "mintHtmlAppToken",
      "revokeHtmlAppToken",
      "refreshVault",
      "setWatchedNote",
      "ackCapture",
      "takePendingDeepLinkNav",
      "ttsSend",
      "ttsFlush",
      "ttsInterrupt",
      "startStt",
      "sendSttAudio",
      "stopStt",
      "syncNow",
      "syncSignIn",
      "syncSignUp",
      "syncSignOut",
      "syncSocialSignIn",
      "syncRequestPasswordReset",
      "createPairingToken",
      "revokeRemoteDevice",
      "installConnector",
      "uninstallConnector",
      "createExecutorOAuthClient",
      "ensureGoogleOAuthClient",
      "repairIntegrations",
    ],
  },
  {
    reason: "recursive",
    why:
      "These drive an AI session — this conversation, its transcripts and system prompt, the " +
      "editor's inline-AI and ghost-text sessions, the unattended routines, and the channel " +
      "that carries a human's answer to your own confirmation prompt. An agent that can " +
      "queue its own turns, rewrite its own instructions or answer its own prompts has no " +
      "stopping condition. Your turn ends when you stop.",
    capabilities: [
      "sendAgentCommand",
      "getAgentHistory",
      "listChatSessions",
      "readChatSession",
      "getAgentSystemPrompt",
      "setFauxAgentScript",
      "generateInlineAi",
      "cancelInlineAi",
      "classifyAiIntent",
      "generateGhostText",
      "cancelGhostText",
      "listGhostModels",
      "listRoutines",
      "upsertRoutine",
      "deleteRoutine",
      "runRoutineNow",
      "restoreRoutineRun",
      "resolveAgentConfirmation",
    ],
  },
  {
    reason: "configuration",
    why:
      "These are the user's settings and the status reads over them — which AI provider, " +
      "which vault, sync, remote access, notifications, voice, connectors, skills, window " +
      "state. Configuration is the user's, and a setting you changed is one they never chose. " +
      "Tell them which Settings section to open.",
    capabilities: [
      "getAppState",
      "getAiProviderSettings",
      "setAiProviderConfig",
      "isTtsAvailable",
      "setVoiceApiKey",
      "getNotificationSettings",
      "updateNotificationSettings",
      "getUiState",
      "setUiState",
      "getVaultRoot",
      "setSyncConfig",
      "getAccountCapabilities",
      "getRemoteAccessState",
      "setRemoteAccessConfig",
      "executorStatus",
      "listExecutorIntegrations",
      "detectExecutorIntegration",
      "listExecutorConnections",
      "getPendingConnectorAuth",
      "listSkills",
      "createSkill",
      "listIntegrations",
    ],
  },
  {
    reason: "already-in-the-file-tools",
    why:
      "You already read and write vault bytes with your own file tools, where every call is " +
      "checked against the note's privacy on live disk and every write is captured so the " +
      "user can undo it. A second route to the same bytes would be neither checked nor " +
      "captured, so there is not one. Use `read`, `edit` and `write` under ./vault.",
    capabilities: ["writeVaultDoc", "writeVaultAsset", "readVaultAsset", "probeNotePrivacy"],
  },
];
