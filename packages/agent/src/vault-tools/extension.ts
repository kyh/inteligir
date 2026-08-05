/**
 * Vault extension — the granted capabilities of the agent grant table
 * (@repo/bridge/agent-grants) that are not knowledge queries: the whole-vault
 * and host-state reads, the guarded checkbox toggle, delegation, and the two
 * destructive proposals.
 *
 * Every tool here calls `ports.vault` / `ports.actions`, never a bridge
 * handler. That is the entire reason these ports exist: the handlers the
 * capabilities are NAMED after are privacy-blind on purpose (the user looking
 * at their own vault must see every note), so a tool generated from one would
 * read `private: true` notes silently. The ports filter at the index and
 * re-probe every survivor against live disk, and they drop rather than
 * annotate — an omission never confirms that a guessed path exists.
 *
 * Pure in-process: no CLI, no setup().
 *
 * RESULT ENCODING: every listing returns `jsonResult` (../extension-helpers),
 * the shared delimiter-safe encoding — a note body can contain any prose
 * delimiter, so prose rows let a note forge hits pointing at paths it does not
 * own. Mutations answer with our own outcome sentence, which is not vault text.
 *
 * REFUSALS: the ports answer with values, never throws, so this file relays a
 * refusal sentence verbatim and never invents one. A model that is told "the
 * note is private" can say so; a model that catches an exception guesses.
 */

import { Type, type Static } from "@sinclair/typebox";

import { NotePathSchema } from "@repo/bridge/ipc-registry";

import type { PiExtensionBundle } from "../extension";
import { grantedDescription, jsonResult, textResult } from "../extension-helpers";

// Page sizes the MODEL sees. The host clamps harder (its privacy re-probe is a
// file read per row); these defaults exist so an unqualified call returns a
// useful window rather than the ceiling, since every row costs context and is
// re-sent with every later turn.
const LISTING_DEFAULT_LIMIT = 50;
const TASKS_DEFAULT_LIMIT = 50;
const WIKI_TARGETS_DEFAULT_LIMIT = 100;

/** The one page shape all three listings take: a folder to narrow to (the only
 * way past the first page — there is no cursor) and a size. */
const FolderSchema = Type.Optional(
  Type.String({
    description:
      "Vault-relative folder to look in, e.g. 'journal/2026'. Omit for the whole vault; " +
      "narrowing is how you reach rows past the limit.",
  }),
);

const ListVaultSchema = Type.Object({
  folder: FolderSchema,
  limit: Type.Optional(
    Type.Number({
      description: `Max entries to return (default ${LISTING_DEFAULT_LIMIT}; the host caps it lower on large pages).`,
    }),
  ),
});

const PageSchema = Type.Object({
  folder: FolderSchema,
  limit: Type.Optional(
    Type.Number({ description: "Max rows to return (the host caps it on large pages)." }),
  ),
});

const NoArgsSchema = Type.Object({});

const TaskRefSchema = Type.Object({
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
});

const DelegateSchema = Type.Object({
  path: Type.String({
    description: "Vault-relative path of the note the checkbox lives in, from list_tasks.",
  }),
  ordinal: Type.Number({
    description: "The checkbox's position among ALL checkboxes in that note, from list_tasks.",
  }),
});

const DelegationIdSchema = Type.Object({
  id: Type.String({ description: "The delegation id, from list_delegations or delegate_task." }),
});

const vaultExtension: PiExtensionBundle = {
  name: "vault-tools",
  register:
    ({ ports }) =>
    (pi) => {
      const { vault, actions } = ports;

      // ---- read-projected ------------------------------------------------
      pi.registerTool({
        name: "list_vault",
        label: "list_vault",
        description:
          `${grantedDescription("list_vault")} Each element is \`{path, name, kind}\`, ` +
          "kind being 'doc' or 'asset'.",
        parameters: ListVaultSchema,
        execute: async (_toolCallId, params: Static<typeof ListVaultSchema>) => {
          const entries = vault.listVault({
            folder: params.folder,
            limit: params.limit ?? LISTING_DEFAULT_LIMIT,
          });
          return textResult(
            jsonResult(
              entries.map((entry) => ({ path: entry.path, name: entry.name, kind: entry.kind })),
            ),
          );
        },
      });

      pi.registerTool({
        name: "read_note",
        label: "read_note",
        description:
          `${grantedDescription("read_note")} Returns the markdown itself, frontmatter ` +
          "included — or one sentence saying there is nothing readable there. Your own " +
          "`read` tool under ./vault does the same job.",
        parameters: NotePathSchema,
        execute: async (_toolCallId, params: Static<typeof NotePathSchema>) => {
          const text = vault.readVaultDoc(params.path);
          if (text === null) {
            return textResult(
              `No readable note at ./vault/${params.path} (missing, not a markdown note, or too large).`,
            );
          }
          return textResult(text);
        },
      });

      pi.registerTool({
        name: "get_note_facts",
        label: "get_note_facts",
        description:
          `${grantedDescription("get_note_facts")} The array holds one ` +
          "`{path, size, modifiedAt}` element, or is empty when there is no such file.",
        parameters: NotePathSchema,
        execute: async (_toolCallId, params: Static<typeof NotePathSchema>) => {
          const facts = vault.getVaultFileFacts(params.path);
          return textResult(jsonResult(facts === null ? [] : [{ path: params.path, ...facts }]));
        },
      });

      pi.registerTool({
        name: "list_tasks",
        label: "list_tasks",
        description:
          `${grantedDescription("list_tasks")} The ONLY source of those two values. Each ` +
          "element is `{path, ordinal, raw, text, checked}` — pass `raw` as `expectedRaw`.",
        parameters: PageSchema,
        execute: async (_toolCallId, params: Static<typeof PageSchema>) => {
          const tasks = vault.listVaultTasks({
            folder: params.folder,
            limit: params.limit ?? TASKS_DEFAULT_LIMIT,
          });
          return textResult(
            jsonResult(
              tasks.map((task) => ({
                path: task.path,
                ordinal: task.ordinal,
                raw: task.raw,
                text: task.text,
                checked: task.checked,
              })),
            ),
          );
        },
      });

      pi.registerTool({
        name: "list_tags",
        label: "list_tags",
        description:
          `${grantedDescription("list_tags")} Inline \`#tags\` and frontmatter \`tags:\` ` +
          "together; narrow to one with search_vault's `tag`. Each element is `{tag, count}`.",
        parameters: NoArgsSchema,
        execute: async () => {
          const result = vault.listTags();
          return result.ok ? textResult(jsonResult(result.tags)) : textResult(result.reason);
        },
      });

      pi.registerTool({
        name: "list_wiki_targets",
        label: "list_wiki_targets",
        description:
          `${grantedDescription("list_wiki_targets")} Each element is ` +
          "`{path, title, type, aliases}`.",
        parameters: PageSchema,
        execute: async (_toolCallId, params: Static<typeof PageSchema>) => {
          const targets = vault.listWikiTargets({
            folder: params.folder,
            limit: params.limit ?? WIKI_TARGETS_DEFAULT_LIMIT,
          });
          return textResult(
            jsonResult(
              targets.map((target) => ({
                path: target.path,
                title: target.title,
                type: target.type,
                aliases: target.aliases,
              })),
            ),
          );
        },
      });

      pi.registerTool({
        name: "get_link_graph",
        label: "get_link_graph",
        description:
          `${grantedDescription("get_link_graph")} Answers "what is disconnected here?" ` +
          'and "what are the hubs?". Returns a JSON object — this one is our own derived ' +
          "summary, not note text.",
        parameters: NoArgsSchema,
        execute: async () => {
          const result = vault.getLinkGraph();
          return result.ok ? textResult(JSON.stringify(result.graph)) : textResult(result.reason);
        },
      });

      pi.registerTool({
        name: "get_sync_state",
        label: "get_sync_state",
        description:
          `${grantedDescription("get_sync_state")} \`enabled: false\` is the ordinary ` +
          "answer, not a problem to fix; Settings → Sync is where the user changes it. " +
          "Returns a JSON object.",
        parameters: NoArgsSchema,
        execute: async () => textResult(JSON.stringify(vault.getSyncState())),
      });

      pi.registerTool({
        name: "list_delegations",
        label: "list_delegations",
        description:
          `${grantedDescription("list_delegations")} Each element is \`{id, sourceFile, ` +
          "lineText, status, createdAt, startedAt, finishedAt, resultSummary, error}`.",
        parameters: NoArgsSchema,
        execute: async () => textResult(jsonResult(vault.listDelegations())),
      });

      // The mutating tiers register only where a human can see the result:
      // `actions` is null on the unattended background session, and a tool
      // that would silently no-op is worse than one that is not offered.
      if (actions === null) return;

      // ---- write-checkpointed ---------------------------------------------
      pi.registerTool({
        name: "toggle_task",
        label: "toggle_task",
        description:
          `${grantedDescription("toggle_task")} It FLIPS the line's current state, so read ` +
          "`checked` from list_tasks first if you need a specific one.",
        parameters: TaskRefSchema,
        execute: async (_toolCallId, params: Static<typeof TaskRefSchema>) => {
          const result = actions.toggleTask(params.path, params.ordinal, params.expectedRaw);
          if (!result.ok) return textResult(result.reason);
          return textResult(
            `${result.checked ? "Checked" : "Unchecked"} the task at ordinal ${params.ordinal} in ${params.path}.`,
          );
        },
      });

      // ---- delegate --------------------------------------------------------
      pi.registerTool({
        name: "delegate_task",
        label: "delegate_task",
        description:
          `${grantedDescription("delegate_task")} Refuses a private note, a stale checkbox, ` +
          "no connected AI provider, or one delegation too many this turn — it says which.",
        parameters: DelegateSchema,
        execute: async (_toolCallId, params: Static<typeof DelegateSchema>) => {
          const result = actions.delegateTask(params.path, params.ordinal);
          if (!result.ok) return textResult(result.reason);
          return textResult(
            `Delegated "${result.lineText}" to the background agent (id ${result.id}). ` +
              `Its status is in list_delegations.`,
          );
        },
      });

      pi.registerTool({
        name: "cancel_delegation",
        label: "cancel_delegation",
        description:
          `${grantedDescription("cancel_delegation")} Use restore_delegation to put the ` +
          "note back.",
        parameters: DelegationIdSchema,
        execute: async (_toolCallId, params: Static<typeof DelegationIdSchema>) => {
          const result = actions.cancelDelegation(params.id);
          return result.ok
            ? textResult(`Cancelled background task ${params.id}.`)
            : textResult(result.reason);
        },
      });

      // ---- destructive, confirmed in the conversation ----------------------
      pi.registerTool({
        name: "delete_note",
        label: "delete_note",
        description:
          `${grantedDescription("delete_note")} Say what you are deleting before you call ` +
          "this, so the dialog does not surprise the user.",
        parameters: NotePathSchema,
        execute: async (_toolCallId, params: Static<typeof NotePathSchema>) => {
          const result = await actions.deleteNote(params.path);
          if (!result.ok) return textResult(result.reason);
          return textResult(
            result.trashed
              ? `Moved ${params.path} to the system trash. The user can recover it from there.`
              : `${params.path} was already gone.`,
          );
        },
      });

      pi.registerTool({
        name: "undo_my_edits",
        label: "undo_my_edits",
        description:
          `${grantedDescription("undo_my_edits")} A background task's edits belong to ` +
          "restore_delegation instead.",
        parameters: NotePathSchema,
        execute: async (_toolCallId, params: Static<typeof NotePathSchema>) => {
          const result = await actions.undoMyEdit(params.path);
          return result.ok
            ? textResult(`Restored ${params.path} to its state before my last edit.`)
            : textResult(result.reason);
        },
      });

      pi.registerTool({
        name: "restore_delegation",
        label: "restore_delegation",
        description:
          `${grantedDescription("restore_delegation")} Name the note it rewinds before you ` +
          `call this, so the dialog does not surprise the user.`,
        parameters: DelegationIdSchema,
        execute: async (_toolCallId, params: Static<typeof DelegationIdSchema>) => {
          const result = await actions.restoreDelegation(params.id);
          return result.ok
            ? textResult(`Restored the note background task ${params.id} edited.`)
            : textResult(result.reason);
        },
      });
    },
};

export default vaultExtension;
