// ---------------------------------------------------------------------------
// The agent grant table — everything the agent may do to the vault and to host
// state, and everything it may not.
//
// Its sibling is REMOTE_ALLOWED_METHODS (channel-policy.ts), and the difference
// in SHAPE is the whole point. A companion client reaches the identical handler
// the workspace reaches: the same code, a narrower list of names, so an
// allowlist of names is a complete policy. The agent cannot use one. It never
// touches a window handler at all — every row is implemented separately,
// host-side, in the object that owns the vault (apps/web agent-tools.ts), with
// its own paging ceilings, its own refusals and its own confirmations. A row's
// `capability` NAMES the bridge method for traceability; it never means the
// tool calls it.
//
// Rows carry a `description` written for a MODEL: what the capability does,
// what it costs, what it refuses. The TSDoc on the registry entries is written
// for maintainers, names things a model has never heard of, and would mislead
// one — do not copy it here.
//
// The never-granted rows are DECLARED rather than merely absent, grouped by
// reason. "The agent can't do that" arriving as silence — an invented tool
// name, a model insisting it has no way to help — is exactly the confusion this
// table exists to end, which is why each group's `why` is rendered into the
// bundled instructions (renderNeverGrantedSection) rather than only read here.
//
// WHAT THIS IS AND IS NOT A BOUNDARY FOR. The model runs in a per-user
// container with a shell, so `never-granted` says nothing about what it can do
// INSIDE that container — it is a statement about what the host implements on
// the agent's behalf. What it does bound is the REACH: these tools are the only
// way out of the container into the user's real vault, and every one of them
// runs in the object rather than the image. `destructive-confirmed` is a prompt
// for the human raised by that object, which is why a container cannot skip it.
//
// Events are absent by construction: both tables are typed `HostMethod`, so a
// host → UI push is unrepresentable in either — a tool is a request/response
// with no subscriber to be. And the partition is TOTAL by construction too:
// `EVERY_METHOD_IS_WEIGHED` at the foot of this file stops compiling when a
// bridge method carries no row, naming it.
// ---------------------------------------------------------------------------

import type { HostMethod } from "./ipc-contract";

/** Capabilities with no bridge twin: the knowledge index answers them and no
 * window has ever asked, so there is no method to name after. */
export const KNOWLEDGE_ONLY_CAPABILITIES = ["listTags", "relatedNotes"] as const;

/** `HostMethod`, not `IpcMethod`, so an event cannot be written into either
 * table: a tool is a request/response with no subscriber to be. */
type AgentCapability = HostMethod | (typeof KNOWLEDGE_ONLY_CAPABILITIES)[number];

/**
 * - `read-projected` — reads over the user's own vault, answered from the
 *   knowledge index rather than the file bytes. Every one is PAGED: the model
 *   gets the first N rows and is told a short page says nothing about what
 *   else exists, because a listing it cannot exhaust is cheaper than one it
 *   would spend a turn's context on.
 * - `write-checkpointed` — a mutation the agent's own file tools cannot
 *   express. Both members capture a restore point (or are their own inverse)
 *   before writing, fail-closed: no undo point, no write.
 * - `delegate` — handing work to the background lane, and un-handing it.
 *   Creates no vault bytes itself; the run it queues is checkpointed by that
 *   lane's own pre-run snapshot. The one tier that manufactures agent TURNS,
 *   so it is capped per turn.
 * - `destructive-confirmed` — the model PROPOSES and a human answers in the
 *   conversation. The confirmation is raised inside the executor, so a tool
 *   cannot forget to ask; a decline comes back as an ordinary value. Undo
 *   lives here, not in `delegate`: rewinding a note to captured bytes discards
 *   everything written since, whoever wrote it, whichever id keys it.
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

export const AGENT_GRANTS = [
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
      "The FIRST N files of the vault in alphabetical order, optionally under one folder. No " +
      "cursor: to see past N, narrow by folder — or use search_vault when you know what you " +
      "want. A short page is normal and says nothing about what else exists.",
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
      "The FIRST N `- [ ]` checkboxes in path order, optionally under one folder; no cursor " +
      "past N. Each row carries its note, its exact source line, and the ordinal toggle_task " +
      "and delegate_task key on — pass both through unchanged, since retyping the line makes " +
      "the write refuse.",
  },
  {
    capability: "listTags",
    agentName: "list_tags",
    tier: "read-projected",
    description:
      "Every tag in the vault with how many notes carry it, most-used first. Counts describe " +
      "the notes you can see. EXPENSIVE: it reads the whole vault, and refuses outright on a " +
      "vault too large to sweep at once. Call it to orient yourself, never in a loop.",
  },
  {
    capability: "listWikiTargets",
    agentName: "list_wiki_targets",
    tier: "read-projected",
    description:
      "The FIRST N names `[[wiki-links]]` can resolve to — note titles, aliases, attachments " +
      "— optionally under one folder, no cursor past N. Check a name here before writing a " +
      "link, so you link to a note that exists instead of dangling one.",
  },
  {
    capability: "getLinkGraph",
    agentName: "get_link_graph",
    tier: "read-projected",
    description:
      "A summary of the vault's link structure: totals, the notes nothing links to or from, " +
      "the hubs, the clusters. The lists are samples, not complete enumerations. EXPENSIVE: " +
      "it reads the whole vault, and refuses outright on one too large to sweep at once.",
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
      "the result under it. For work that would outlast this conversation, not for something " +
      "you can do now — it runs unattended, with nobody watching. Only a few per turn; past " +
      "that it refuses, because queueing your own successors has no end.",
  },
  {
    capability: "cancelDelegation",
    agentName: "cancel_delegation",
    tier: "delegate",
    description:
      "Stop a queued or running background task. Work it already wrote to the note stays — " +
      "cancelling is not undoing.",
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
      "before it. Reaches only edits made in the CURRENT conversation; anything older is the " +
      "user's own undo, not yours. Destructive: everything written to the note since goes " +
      "with it. The user is asked first and may say no.",
  },
  {
    capability: "restoreDelegationSnapshot",
    agentName: "restore_delegation",
    tier: "destructive-confirmed",
    description:
      "Propose putting the note a finished background task edited back to the bytes it had " +
      "before that task ran. The SAME whole-file rewind as undo_my_edits, keyed by task: " +
      "everything written to that note since the run — the task's work, the user's, yours — " +
      "goes with it. The user is asked first, and a running task refuses.",
  },
] as const satisfies readonly AgentGrant[];

/**
 * - `needs-a-human-at-a-screen` — the action only means anything when a person
 *   is present to see or answer it.
 * - `window-bookkeeping` — the UI keeping step with itself; nothing a person
 *   would recognize as work done.
 * - `recursive` — driving the agent itself.
 * - `configuration` — the user's settings and the status reads over them.
 * - `already-in-the-file-tools` — the same effect already reaches the agent
 *   through a path that is gated and captured.
 */
type AgentDenialReason =
  | "needs-a-human-at-a-screen"
  | "window-bookkeeping"
  | "recursive"
  | "configuration"
  | "already-in-the-file-tools";

export type AgentDenialGroup = {
  reason: AgentDenialReason;
  /** Also written for a model — it is the answer to "why can't I?". */
  why: string;
  capabilities: readonly HostMethod[];
};

export const AGENT_NEVER_GRANTED = [
  {
    reason: "needs-a-human-at-a-screen",
    why:
      "These open a dialog, a browser, a microphone, a speaker, or the window itself. The " +
      "action only means anything with a person there — and a person who is there does not " +
      "need you to do it for them. Ask them, and say where.",
    capabilities: [
      "transition",
      "reauthenticate",
      "connectAiProvider",
      "disconnectAiProvider",
      "ttsSend",
      "ttsFlush",
      "ttsInterrupt",
      "startStt",
      "sendSttAudio",
      "stopStt",
    ],
  },
  {
    reason: "window-bookkeeping",
    why:
      "The app window keeping step with itself: when it re-reads the file listing, " +
      "acknowledging a captured line it already applied, collecting a link the browser handed " +
      "it. None of it changes a note, and the state behind it is rebuilt without you. If a " +
      "note looks stale, read the file again — that is the real answer.",
    capabilities: ["refreshVault", "ackCapture", "takePendingDeepLinkNav"],
  },
  {
    reason: "recursive",
    why:
      "These drive an AI session — this conversation, its transcripts and system prompt, the " +
      "editor's inline-AI and ghost-text sessions, the unattended routines, and the channel " +
      "your own confirmation prompts are answered on. An agent that can queue its own turns, " +
      "rewrite its own instructions or answer its own prompts has no stopping condition. " +
      "Your turn ends when you stop.",
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
      "The user's settings and the status reads over them — AI provider, vault, account, " +
      "voice, skills, window state. Configuration is theirs, and a setting you changed is one " +
      "they never chose. Tell them which Settings section to open.",
    capabilities: [
      "getAppState",
      "getAiProviderSettings",
      "setAiProviderConfig",
      "isTtsAvailable",
      "setVoiceApiKey",
      "getUiState",
      "setUiState",
      "getWorkspaceBoot",
      "listSkills",
      "createSkill",
    ],
  },
  {
    reason: "already-in-the-file-tools",
    why:
      "You already read and write vault bytes with your own file tools, and every write is " +
      "captured for the user to undo. A second route to the same bytes would not be, so there " +
      "is not one. Use `read`, `edit` and `write` under ./vault.",
    capabilities: ["writeVaultDoc", "writeVaultAsset", "readVaultAsset"],
  },
] as const satisfies readonly AgentDenialGroup[];

/** Host methods this table neither grants nor declares never-granted. `never`
 * when the table is complete — which is what the assertion below turns into a
 * COMPILE error, in this file, naming the method that has no row. */
type UnweighedCapability = Exclude<
  HostMethod,
  | (typeof AGENT_GRANTS)[number]["capability"]
  | (typeof AGENT_NEVER_GRANTED)[number]["capabilities"][number]
>;

/**
 * CLICKING ⇒ WEIGHED. Adding a bridge method stops this line compiling until
 * it carries a row — which is the moment "may the agent do this?" gets asked.
 * The usual answer is an AGENT_NEVER_GRANTED group whose `why` already fits; a
 * grant is a separate implementation host-side, never the window handler.
 *
 * A witness rather than a bare type alias so the grant-table test can name it,
 * and so an unweighed method reads as `Type 'true' is not assignable to type
 * '"yourNewMethod"'` instead of passing silently.
 */
export const EVERY_METHOD_IS_WEIGHED: UnweighedCapability extends never
  ? true
  : UnweighedCapability = true;

/**
 * The never-granted groups as the model reads them — the section the bundled
 * AGENTS.md carries, rendered from the table so the prompt and the policy
 * cannot disagree.
 *
 * The `capabilities` arrays stay out of it deliberately: those are bridge
 * method names the model has never seen and cannot call, so listing them
 * spends per-turn context on noise. The `why` is the whole answer.
 */
export function renderNeverGrantedSection(): string {
  const groups = AGENT_NEVER_GRANTED.map(
    (group) => `- **${group.reason.replaceAll("-", " ")}** — ${group.why}`,
  );
  return [
    "## What you can't do",
    "",
    "The app can do these; you are not given them. When one is what the user needs, say so " +
      "plainly and name the place in the app — don't invent a tool for it, and don't reach " +
      "around it with `bash`, `browser` or `peekaboo`.",
    "",
    ...groups,
    "",
  ].join("\n");
}
