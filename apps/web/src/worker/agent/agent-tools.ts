// ---------------------------------------------------------------------------
// The agent's granted capabilities, implemented HOST-SIDE.
//
// The container registers these tools with pi and forwards every call back
// here; it holds no implementation and no policy. That placement is the whole
// design:
//
//   • the grant table (@repo/bridge/agent-grants) stays the one declaration of
//     what the agent may do, and every tool's model-facing sentence comes FROM
//     it (`grantedDescription`) — a tool with no row throws at manifest time,
//     exactly as it does on the desktop.
//   • the destructive tier raises its confirmation INSIDE the executor, so no
//     tool can skip it. A container that decided not to ask would still be
//     asking, because the asking is not in the container.
//   • a compromised image cannot widen the surface. It can call these tools
//     with whatever arguments it likes — and every one of them is
//     schema-checked and scoped to this user's own vault before it runs.
//
// THE UNATTENDED LANE GETS A NARROWER MENU, and it is narrowed in TWO places
// on purpose. The manifest a container boots with omits the tiers an
// unattended turn may not use, so the model never sees a tool it cannot call;
// the executor refuses them anyway, so a container running a stale boot cannot
// reach one. Which tiers those are comes from the grant table's own `tier`
// field rather than a second list here — the same rule the desktop states as
// "`AgentPorts.actions` is null in the background session".
//
// RESULT ENCODING: every listing is a JSON array (`rows`), never
// newline-joined prose. A note body can contain any prose delimiter, so prose
// rows let a note forge hits pointing at paths it does not own. Outcome
// sentences stay prose — they are our own words, not vault text.
// ---------------------------------------------------------------------------

import { AGENT_GRANTS, type AgentGrant, type AgentGrantTier } from "@repo/bridge/agent-grants";
import type {
  CreateDelegationParams,
  CreateDelegationResult,
  ListDelegationsResult,
  RestoreSnapshotResult,
} from "@repo/bridge/delegation";
import type { AgentConfirmationRequest } from "@repo/bridge/ipc-registry";
import { toErrorMessage } from "@repo/bridge/wire-helpers";
import { toggleTaskAtOrdinal } from "@repo/notes/knowledge/guarded-line-edit";
import { isDocPath } from "@repo/notes/knowledge/doc-file";
import { Type, type Static, type TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

import type { UserKnowledge } from "../host/knowledge/user-knowledge";
import { heldDeletionMessage, type UserVault } from "../host/vault/user-vault";
import { renameWithLinkRewrite } from "../host/vault/vault-rename";
import type { AgentSnapshots, SnapshotScope } from "./agent-snapshots";
import type { SandboxToolSpec } from "./sandbox-port";

/** Page sizes the MODEL sees, and the ceilings it cannot exceed. Every row
 * costs context and is re-sent with every later turn. */
const LISTING_DEFAULT = 50;
const LISTING_MAX = 200;
const WIKI_TARGETS_DEFAULT = 100;
const SEARCH_DEFAULT = 20;
const SEARCH_MAX = 50;
const BACKLINKS_MAX = 200;
const LINKS_MAX = 200;
const RELATED_MAX = 12;

/** Largest note handed back whole. Past this, reading it costs more context
 * than any answer it could support. */
const MAX_NOTE_CHARS = 200_000;

/** A vault this size makes the whole-corpus sweeps (`list_tags`,
 * `get_link_graph`) an answer nobody can read and a payload nobody should pay
 * for, so they refuse outright rather than truncate into a wrong number. */
const MAX_SWEEP_NOTES = 20_000;

/** Notes named in a graph summary's samples. */
const GRAPH_SAMPLE = 12;

/** Background tasks `list_delegations` hands back, newest first. */
const DELEGATIONS_MAX = 50;

/** Delegations one interactive turn may queue. Small on purpose, and the same
 * number the desktop's action port uses: a turn that genuinely needs a fourth
 * background task is a turn that should be reporting back instead. It is the
 * one tier that manufactures agent TURNS, so it is the one with a budget. */
const MAX_DELEGATIONS_PER_TURN = 3;

export type AgentToolResult = { readonly isError: boolean; readonly text: string };

/** The delegation surface the `delegate` tier reaches, narrowed to the four
 * capabilities the grant table declares. Structural, so the real store
 * satisfies it and nothing here can reach past those four. */
export type DelegationToolPort = {
  list(): ListDelegationsResult;
  create(params: CreateDelegationParams, turnId: string | null): Promise<CreateDelegationResult>;
  cancel(id: string): Promise<{ ok: boolean }>;
  restoreSnapshot(id: string): Promise<RestoreSnapshotResult>;
  /** How many this turn has already queued — the cap's counter. */
  queuedInTurn(turnId: string): number;
};

/** What the executor needs. Structural so tests drive the real tools over a
 * real vault and index without a container anywhere. */
export type AgentToolContext = {
  readonly vault: UserVault;
  readonly knowledge: UserKnowledge;
  readonly snapshots: AgentSnapshots;
  readonly delegations: DelegationToolPort;
  /** Where this turn's restore points live — the conversation, or the
   * background run. It is what `undo_my_edits` scopes its promise to. */
  readonly scope: SnapshotScope;
  /** The container turn this call belongs to — the boundary the delegate cap
   * counts against. */
  readonly turnId: string;
  /** Whether a human is in this conversation. False on the background lane,
   * where the delegate and destructive tiers do not exist. */
  readonly attended: boolean;
  /** Raise a destructive proposal with the human and wait for the answer. A
   * non-answer is a decline. */
  readonly confirm: (proposal: Omit<AgentConfirmationRequest, "id">) => Promise<boolean>;
};

type ToolDefinition = {
  readonly name: string;
  readonly parameters: TSchema;
  /** Appended to the grant table's sentence: mechanics only (result shape,
   * caps, argument rules), never a second statement of what is granted. */
  readonly mechanics: string;
  readonly execute: (ctx: AgentToolContext, args: unknown) => Promise<AgentToolResult>;
};

/**
 * Why a tier is absent from an UNATTENDED turn, or null when it is granted
 * there.
 *
 * Both refusals are the desktop's own reasoning, said to the model rather than
 * met with silence: a proposal has no conversation to be confirmed in, and a
 * background agent that could delegate would queue its own successors.
 */
function unattendedRefusal(tier: AgentGrantTier): string | null {
  switch (tier) {
    case "destructive-confirmed":
      return (
        "Nobody is watching this run, so there is no conversation to confirm a destructive " +
        "action in. Say what you would have done and leave it to the user."
      );
    case "delegate":
      return (
        "You ARE the background agent. Handing work to it would queue your own successors, " +
        "which has no stopping condition. Do the work in this run, or report that it is too large."
      );
    case "read-projected":
    case "write-checkpointed":
      return null;
  }
}

// ---------------------------------------------------------------------------
// Argument schemas
// ---------------------------------------------------------------------------

const NotePath = Type.Object(
  {
    path: Type.String({
      description:
        "Path to a markdown note, relative to the vault root — e.g. 'notes/ideas.md'. " +
        "Never absolute, never escaping the vault.",
    }),
  },
  { additionalProperties: false },
);

const Folder = Type.Optional(
  Type.String({
    description:
      "Vault-relative folder to look in, e.g. 'journal/2026'. Omit for the whole vault; " +
      "narrowing is how you reach rows past the limit.",
  }),
);

const Page = Type.Object(
  {
    folder: Folder,
    limit: Type.Optional(
      Type.Number({ description: `Max rows to return (hard-capped at ${LISTING_MAX}).` }),
    ),
  },
  { additionalProperties: false },
);

const NoArgs = Type.Object({}, { additionalProperties: false });

const SearchArgs = Type.Object(
  {
    query: Type.Optional(
      Type.String({
        description:
          "Terms to match against note titles and body text. Optional when `tag` is set, " +
          "which then lists every note carrying it.",
      }),
    ),
    tag: Type.Optional(
      Type.String({
        description:
          "Restrict to notes carrying this tag (case-insensitive; inline `#tag` or " +
          "frontmatter `tags`). Combine with `query` to search within it.",
      }),
    ),
    limit: Type.Optional(
      Type.Number({
        description: `Max hits (default ${SEARCH_DEFAULT}, hard-capped at ${SEARCH_MAX}).`,
      }),
    ),
  },
  { additionalProperties: false },
);

const TaskRef = Type.Object(
  {
    path: Type.String({
      description: "Vault-relative path of the note the checkbox lives in, from list_tasks.",
    }),
    ordinal: Type.Number({
      description:
        "The checkbox's position among ALL checkboxes in that note, from list_tasks. Not a " +
        "line number.",
    }),
    expectedRaw: Type.String({
      description:
        "The checkbox's exact source line from list_tasks, byte for byte. The write refuses " +
        "unless the file still contains it — that is what stops it ticking the wrong box.",
    }),
  },
  { additionalProperties: false },
);

const RenameArgs = Type.Object(
  {
    from: Type.String({
      description: "Current vault-relative path of the file to rename or move.",
    }),
    to: Type.String({
      description:
        "New vault-relative path ('notes/new.md', or 'archive/old.md' to move it). The " +
        "destination file name must be a valid note name.",
    }),
  },
  { additionalProperties: false },
);

const DelegateArgs = Type.Object(
  {
    path: Type.String({
      description: "Vault-relative path of the note the checkbox lives in, from list_tasks.",
    }),
    ordinal: Type.Number({
      description:
        "The checkbox's position among ALL checkboxes in that note, from list_tasks. Not a " +
        "line number.",
    }),
  },
  { additionalProperties: false },
);

const DelegationRef = Type.Object(
  {
    id: Type.String({ description: "The background task's id, from list_delegations." }),
  },
  { additionalProperties: false },
);

// ---------------------------------------------------------------------------
// The tools
// ---------------------------------------------------------------------------

const TOOLS: readonly ToolDefinition[] = [
  {
    name: "search_vault",
    parameters: SearchArgs,
    mechanics:
      "Each element is `{path, snippet}` (`snippet` is omitted when listing a tag with no query).",
    execute: async (ctx, raw) => {
      const args = parse(SearchArgs, raw);
      const query = (args.query ?? "").trim();
      const tag = (args.tag ?? "").trim();
      if (query === "" && tag === "") {
        return failure("Provide a query or a tag to search.");
      }
      const hits = await ctx.knowledge.search({
        query,
        tag,
        limit: Math.min(args.limit ?? SEARCH_DEFAULT, SEARCH_MAX),
      });
      return rows(
        hits.map((hit) =>
          hit.snippet === "" ? { path: hit.path } : { path: hit.path, snippet: hit.snippet },
        ),
      );
    },
  },
  {
    name: "get_backlinks",
    parameters: NotePath,
    mechanics: `Each element is \`{path}\`; at most ${BACKLINKS_MAX} are returned.`,
    execute: async (ctx, raw) => {
      const { path } = parse(NotePath, raw);
      const hits = await ctx.knowledge.backlinks(path);
      const paths = [...new Set(hits.map((hit) => hit.sourcePath))];
      return rows(paths.slice(0, BACKLINKS_MAX).map((source) => ({ path: source })));
    },
  },
  {
    name: "get_links",
    parameters: NotePath,
    mechanics:
      "Each element is `{path}` for a resolved target, or `{target, unresolved: true}` for a " +
      `link whose note does not exist yet. De-duped; at most ${LINKS_MAX} are returned.`,
    execute: async (ctx, raw) => {
      const { path } = parse(NotePath, raw);
      const entries = await ctx.knowledge.forwardLinks(path);
      // De-duped by resolved path, and by RAW TARGET TEXT when the link
      // dangles, so several refs to the same not-yet-created name collapse
      // into one row without colliding with a real path.
      const deduped = new Map<string, { path: string } | { target: string; unresolved: true }>();
      for (const entry of entries) {
        if (entry.targetPath === null) {
          deduped.set(`unresolved:${entry.target}`, { target: entry.target, unresolved: true });
        } else {
          deduped.set(`path:${entry.targetPath}`, { path: entry.targetPath });
        }
      }
      return rows([...deduped.values()].slice(0, LINKS_MAX));
    },
  },
  {
    name: "related_notes",
    parameters: NotePath,
    mechanics: "Each element is `{path, reasons}`, reasons being an array of strings.",
    execute: async (ctx, raw) => {
      const { path } = parse(NotePath, raw);
      const hits = await ctx.knowledge.relatedNotes(path, RELATED_MAX);
      // `reasons` stays an array rather than a joined string: the same
      // delimiter argument as the row separator, one level down.
      return rows(hits.map((hit) => ({ path: hit.path, reasons: hit.reasons })));
    },
  },
  {
    name: "list_vault",
    parameters: Page,
    mechanics: "Each element is `{path, name, kind}`, kind being 'doc' or 'other'.",
    execute: (ctx, raw) => {
      const args = parse(Page, raw);
      const entries = pageOf(
        ctx.vault.list(),
        args.folder,
        args.limit,
        LISTING_DEFAULT,
        (entry) => entry.path,
      );
      return Promise.resolve(
        rows(entries.map((entry) => ({ path: entry.path, name: entry.name, kind: entry.kind }))),
      );
    },
  },
  {
    name: "read_note",
    parameters: NotePath,
    mechanics:
      "Returns the markdown itself, frontmatter included — or one sentence saying there is " +
      "nothing readable there. Your own `read` tool under ./vault does the same job.",
    execute: async (ctx, raw) => {
      const { path } = parse(NotePath, raw);
      const file = ctx.vault.lookup(path);
      if (file === null || file.state !== "live" || !isDocPath(file.path)) {
        return failure(`No readable note at ./vault/${path} (missing or not a markdown note).`);
      }
      if (file.size > MAX_NOTE_CHARS) {
        return failure(`${file.path} is too large to hand over (${file.size} bytes).`);
      }
      return success(await ctx.vault.readText(file.path));
    },
  },
  {
    name: "get_note_facts",
    parameters: NotePath,
    mechanics:
      "The array holds one `{path, sizeBytes, modifiedMs}` element, or is empty when there is " +
      "no such file.",
    execute: (ctx, raw) => {
      const { path } = parse(NotePath, raw);
      const facts = ctx.vault.fileFacts(path);
      return Promise.resolve(rows(facts === null ? [] : [{ path, ...facts }]));
    },
  },
  {
    name: "list_tasks",
    parameters: Page,
    mechanics:
      "The ONLY source of the ordinal and the source line. Each element is " +
      "`{path, ordinal, raw, text, checked}` — pass `raw` as `expectedRaw`.",
    execute: async (ctx, raw) => {
      const args = parse(Page, raw);
      const tasks = pageOf(
        await ctx.knowledge.tasks(),
        args.folder,
        args.limit,
        LISTING_DEFAULT,
        (task) => task.path,
      );
      return rows(
        tasks.map((task) => ({
          path: task.path,
          ordinal: task.ordinal,
          raw: task.raw,
          text: task.text,
          checked: task.checked,
        })),
      );
    },
  },
  {
    name: "list_tags",
    parameters: NoArgs,
    mechanics:
      "Inline `#tags` and frontmatter `tags:` together; narrow to one with search_vault's " +
      "`tag`. Each element is `{tag, count}`.",
    execute: async (ctx) => {
      const refusal = sweepRefusal(ctx, "list_tags");
      if (refusal !== null) return refusal;
      return rows(await ctx.knowledge.tags());
    },
  },
  {
    name: "list_wiki_targets",
    parameters: Page,
    mechanics: "Each element is `{path, title, type, aliases}`.",
    execute: async (ctx, raw) => {
      const args = parse(Page, raw);
      const targets = pageOf(
        await ctx.knowledge.wikiTargets(),
        args.folder,
        args.limit,
        WIKI_TARGETS_DEFAULT,
        (target) => target.path,
      );
      return rows(
        targets.map((target) => ({
          path: target.path,
          title: target.title,
          type: target.type,
          aliases: target.aliases,
        })),
      );
    },
  },
  {
    name: "get_link_graph",
    parameters: NoArgs,
    mechanics:
      'Answers "what is disconnected here?" and "what are the hubs?". Returns a JSON object — ' +
      "this one is our own derived summary, not note text.",
    execute: async (ctx) => {
      const refusal = sweepRefusal(ctx, "get_link_graph");
      if (refusal !== null) return refusal;
      return success(JSON.stringify(await linkGraphSummary(ctx)));
    },
  },
  {
    name: "list_delegations",
    parameters: NoArgs,
    mechanics:
      `The ${DELEGATIONS_MAX} most recent, each \`{id, path, line, status, result}\` — ` +
      "`result` is the one-line outcome, or the reason it failed. Pass `id` to " +
      "cancel_delegation and restore_delegation.",
    execute: (ctx) =>
      Promise.resolve(
        rows(
          ctx.delegations
            .list()
            .delegations.toReversed()
            .slice(0, DELEGATIONS_MAX)
            .map((delegation) => ({
              id: delegation.id,
              path: delegation.sourceFile,
              line: delegation.lineText,
              status: delegation.status,
              result: delegation.resultSummary ?? delegation.error ?? "",
            })),
        ),
      ),
  },

  // ---- write-checkpointed --------------------------------------------------
  {
    name: "toggle_task",
    parameters: TaskRef,
    mechanics:
      "It FLIPS the line's current state, so read `checked` from list_tasks first if you need " +
      "a specific one.",
    execute: async (ctx, raw) => {
      const args = parse(TaskRef, raw);
      let source: string;
      try {
        source = await ctx.vault.readText(args.path);
      } catch (error) {
        ctx.knowledge.heal();
        return failure(`Could not read ${args.path}: ${toErrorMessage(error)}`);
      }
      const edit = toggleTaskAtOrdinal(source, args.ordinal, args.expectedRaw);
      if (!edit.ok) {
        ctx.knowledge.heal();
        return failure(toggleRefusal(edit.reason));
      }
      // Fail-closed: no restore point, no write.
      if ((await ctx.snapshots.capture(ctx.scope, args.path)) === null) {
        return failure(`Could not save a restore point for ${args.path}, so I did not write it.`);
      }
      const written = await ctx.vault.writeText(args.path, edit.content);
      if (!written.ok) return failure(`Could not write ${args.path}.`);
      return success(
        `${edit.checked ? "Checked" : "Unchecked"} the task at ordinal ${args.ordinal} in ${args.path}.`,
      );
    },
  },
  {
    name: "rename_note",
    parameters: RenameArgs,
    mechanics: "",
    execute: async (ctx, raw) => {
      const args = parse(RenameArgs, raw);
      if ((await ctx.snapshots.capture(ctx.scope, args.from)) === null) {
        return failure(`Could not save a restore point for ${args.from}, so I did not move it.`);
      }
      const result = await renameWithLinkRewrite(ctx.vault, ctx.knowledge, args.from, args.to);
      if (!result.ok) return failure(`Rename failed: ${result.error}`);
      return success(`Renamed ${args.from} to ${args.to}, rewriting the links that pointed at it.`);
    },
  },

  // ---- delegate — the one tier that manufactures agent turns -----------------
  {
    name: "delegate_task",
    parameters: DelegateArgs,
    mechanics:
      `At most ${MAX_DELEGATIONS_PER_TURN} per turn. The task runs unattended on its own ` +
      "container, so say what you handed off before you call this.",
    execute: async (ctx, raw) => {
      const args = parse(DelegateArgs, raw);
      if (ctx.delegations.queuedInTurn(ctx.turnId) >= MAX_DELEGATIONS_PER_TURN) {
        return failure(
          `You have already handed ${MAX_DELEGATIONS_PER_TURN} tasks to the background agent ` +
            "in this turn. Report back on those before queueing more.",
        );
      }
      const created = await ctx.delegations.create(
        { sourceFile: args.path, ordinal: args.ordinal },
        ctx.turnId,
      );
      if (!created.ok) return failure(created.error);
      return success(
        `Handed "${created.delegation.anchor.text}" (${args.path}) to the background agent.`,
      );
    },
  },
  {
    name: "cancel_delegation",
    parameters: DelegationRef,
    mechanics: "",
    execute: async (ctx, raw) => {
      const { id } = parse(DelegationRef, raw);
      const cancelled = await ctx.delegations.cancel(id);
      return cancelled.ok
        ? success(`Cancelled background task ${id}.`)
        : failure(`There is no queued or running background task with id ${id}.`);
    },
  },

  // ---- destructive, confirmed in the conversation ---------------------------
  {
    name: "delete_note",
    parameters: NotePath,
    mechanics:
      "Say what you are deleting before you call this, so the dialog does not surprise the user.",
    execute: async (ctx, raw) => {
      const { path } = parse(NotePath, raw);
      const file = ctx.vault.lookup(path);
      if (file === null || file.state !== "live") return success(`${path} was already gone.`);
      const confirmed = await ctx.confirm({
        title: `Delete ${file.path}?`,
        detail:
          "The agent proposed removing this file. It moves to the vault's trash and can be " +
          "restored from there for 30 days.",
        confirmLabel: "Delete",
      });
      if (!confirmed) return failure(`The user declined to delete ${file.path}.`);
      const result = await ctx.vault.trash([file.path]);
      if (!result.ok) return failure(heldDeletionMessage(result.held));
      return success(
        `Moved ${file.path} to the vault's trash. The user can restore it from there.`,
      );
    },
  },
  {
    name: "undo_my_edits",
    parameters: NotePath,
    mechanics: "A background task's edits are not yours to undo.",
    execute: async (ctx, raw) => {
      const { path } = parse(NotePath, raw);
      const snapshotId = ctx.snapshots.latest(ctx.scope, path);
      if (snapshotId === null) {
        return failure(`I have not edited ${path} in this conversation.`);
      }
      const confirmed = await ctx.confirm({
        title: `Undo the agent's edit to ${path}?`,
        detail:
          "This puts the note back to the bytes it had before the agent's most recent edit in " +
          "this conversation. Everything written to it since goes with it.",
        confirmLabel: "Undo",
      });
      if (!confirmed) return failure(`The user declined to undo my edit to ${path}.`);
      const result = await ctx.snapshots.restore([snapshotId], ctx.scope.origin);
      if (!result.ok) return failure(result.reason);
      // Consumed, so a second undo of the same edit cannot rewind to the same
      // bytes and report success while changing nothing.
      await ctx.snapshots.consume(snapshotId);
      return success(`Restored ${path} to its state before my last edit.`);
    },
  },
  {
    name: "restore_delegation",
    parameters: DelegationRef,
    mechanics: "",
    execute: async (ctx, raw) => {
      const { id } = parse(DelegationRef, raw);
      const delegation = ctx.delegations.list().delegations.find((row) => row.id === id);
      if (delegation === undefined) return failure(`There is no background task with id ${id}.`);
      const confirmed = await ctx.confirm({
        title: `Undo the background task's edit to ${delegation.sourceFile}?`,
        detail:
          `This puts ${delegation.sourceFile} back to the bytes it had before that task ran. ` +
          "Everything written to it since goes with it.",
        confirmLabel: "Restore",
      });
      if (!confirmed) {
        return failure(`The user declined to restore ${delegation.sourceFile}.`);
      }
      const result = await ctx.delegations.restoreSnapshot(id);
      if (!result.ok) return failure(result.error);
      return success(`Restored ${delegation.sourceFile} to its state before that task ran.`);
    },
  },
];

// ---------------------------------------------------------------------------
// Manifest + dispatch
// ---------------------------------------------------------------------------

/**
 * The tools a container registers, with each description opening on the grant
 * table's own sentence.
 *
 * `attended` narrows the MENU rather than only the answers: a background
 * container is never handed the delegate or destructive tiers, so the model
 * does not spend a turn discovering it cannot use them.
 *
 * Throws for a tool with no grant row, which is the point: a capability nobody
 * declared is a capability nobody weighed.
 */
export function agentToolManifest(attended: boolean): SandboxToolSpec[] {
  return TOOLS.flatMap((tool) => {
    const grant = grantFor(tool.name);
    if (!attended && unattendedRefusal(grant.tier) !== null) return [];
    return [
      {
        name: tool.name,
        description:
          tool.mechanics === "" ? grant.description : `${grant.description} ${tool.mechanics}`,
        parameters: tool.parameters,
      },
    ];
  });
}

/** The grant row for `agentName`, or a throw naming the gap. */
function grantFor(agentName: string): AgentGrant {
  const grant = AGENT_GRANTS.find((row) => row.agentName === agentName);
  if (grant === undefined) {
    throw new Error(
      `tool '${agentName}' is not in the agent grant table — declare it in ` +
        `@repo/bridge/agent-grants before offering it.`,
    );
  }
  return grant;
}

/** Tool names this host implements. */
export function agentToolNames(): readonly string[] {
  return TOOLS.map((tool) => tool.name);
}

/**
 * Run one tool call from a container.
 *
 * A tool that is not offered, one its lane may not use, or arguments that do
 * not fit its schema all come back as an ERROR RESULT rather than a throw: pi
 * turns an error result into something the model reads and can correct, where a
 * transport failure reads as the host being broken.
 */
export async function executeAgentTool(
  ctx: AgentToolContext,
  name: string,
  args: unknown,
): Promise<AgentToolResult> {
  const tool = TOOLS.find((candidate) => candidate.name === name);
  if (tool === undefined) return failure(`There is no tool called ${name} on this host.`);
  if (!ctx.attended) {
    // The manifest already withheld it; this is what holds when a container is
    // running a boot from before that was true.
    const refusal = unattendedRefusal(grantFor(name).tier);
    if (refusal !== null) return failure(refusal);
  }
  try {
    return await tool.execute(ctx, args);
  } catch (error) {
    return failure(`${name} failed: ${toErrorMessage(error)}`);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function success(text: string): AgentToolResult {
  return { isError: false, text };
}

function failure(text: string): AgentToolResult {
  return { isError: true, text };
}

/** Untrusted vault text, delimiter-safely encoded — the ONE result encoding for
 * every tool that returns rows of the user's own content. Prose rows carry
 * delimiters a note's body can contain, so a note could forge hits pointing at
 * paths it does not own; JSON escapes both. */
function rows(values: readonly unknown[]): AgentToolResult {
  return success(JSON.stringify(values));
}

/** Validate `raw` against `schema`, or throw a message naming the mismatch —
 * `executeAgentTool` turns it into an error result the model can correct. */
function parse<T extends TSchema>(schema: T, raw: unknown): Static<T> {
  if (!Value.Check(schema, raw)) {
    const first = Value.Errors(schema, raw).First();
    throw new Error(
      `bad arguments — ${first ? `${first.path || "/"}: ${first.message}` : "shape mismatch"}`,
    );
  }
  return Value.Decode(schema, raw);
}

/** The FIRST `limit` rows under `folder`, in the projection's own order. There
 * is no cursor: narrowing by folder is the only way past the page, which the
 * tool descriptions say. */
function pageOf<T>(
  all: readonly T[],
  folder: string | undefined,
  limit: number | undefined,
  fallback: number,
  pathOf: (row: T) => string,
): T[] {
  const prefix = folder === undefined || folder === "" ? null : `${folder.replace(/\/+$/, "")}/`;
  const scoped = prefix === null ? all : all.filter((row) => pathOf(row).startsWith(prefix));
  return scoped.slice(0, Math.min(limit ?? fallback, LISTING_MAX));
}

/** The whole-corpus sweeps report numbers over the WHOLE vault, so a truncated
 * window would be a wrong number rather than a short page — there is nothing to
 * paginate, only a size past which they refuse. */
function sweepRefusal(ctx: AgentToolContext, tool: string): AgentToolResult | null {
  const count = ctx.vault.list().length;
  if (count <= MAX_SWEEP_NOTES) return null;
  return failure(
    `${tool} reads the whole vault, and this one has ${count} files — too many to sweep at ` +
      `once. Use search_vault or list_vault with a folder instead.`,
  );
}

function toggleRefusal(reason: "line-missing" | "line-changed" | "not-a-checkbox"): string {
  switch (reason) {
    case "line-missing":
      return "That task is no longer in the file. Re-read list_tasks and try again.";
    case "line-changed":
      return "The note changed since the task list was built. Re-read list_tasks and try again.";
    case "not-a-checkbox":
      return "That line isn't a checkbox anymore.";
  }
}

/** The DERIVED graph answer — never the raw node/edge blob, which is tens of
 * megabytes of JSON on a large vault and unreadable to a model anyway. */
async function linkGraphSummary(ctx: AgentToolContext): Promise<{
  totalNotes: number;
  totalLinks: number;
  orphans: string[];
  hubs: { path: string; title: string; degree: number }[];
}> {
  const graph = await ctx.knowledge.linkGraph({});
  const real = graph.nodes.filter((node) => !node.phantom);
  // Built once: a per-edge lookup over the node array is quadratic, and this
  // tool exists to be called on a vault large enough for that to matter.
  const phantoms = new Set(graph.nodes.filter((node) => node.phantom).map((node) => node.id));
  const hubs = real
    .toSorted((a, b) => b.degree - a.degree)
    .slice(0, GRAPH_SAMPLE)
    .map((node) => ({ path: node.path ?? node.id, title: node.title, degree: node.degree }));
  const orphans = real
    .filter((node) => node.degree === 0)
    .slice(0, GRAPH_SAMPLE)
    .map((node) => node.path ?? node.id);
  return {
    totalNotes: real.length,
    // Links between two REAL notes; a phantom endpoint is a link with no note
    // behind it, which is a different question (`get_links` answers it).
    totalLinks: graph.edges.filter(
      (edge) => !phantoms.has(edge.source) && !phantoms.has(edge.target),
    ).length,
    orphans,
    hubs,
  };
}
