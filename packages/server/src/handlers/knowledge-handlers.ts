import { toggleTaskAtOrdinal } from "@repo/notes/knowledge/guarded-line-edit";
import { SEARCH_DEFAULT_LIMIT } from "@repo/notes/knowledge/knowledge-index";
import { boundGraph } from "@repo/notes/knowledge/link-graph-index";
import { searchVaultNotes } from "@repo/notes/knowledge/vault-search";
import { toErrorMessage } from "@repo/bridge/wire-helpers";
import type { ToggleTaskResult } from "@repo/bridge/ipc-registry";

import type { HandlerRegistrar } from "./handler-registry";
import type { HostServices } from "../boot/host-services";

/** Renderer-facing failure text per refusal reason (the raw reason rides
 * along for the renderer's own branching). */
function toggleFailureMessage(reason: "line-missing" | "line-changed" | "not-a-checkbox"): string {
  switch (reason) {
    case "line-missing":
      return "That task is no longer in the file.";
    case "line-changed":
      return "The note changed since the task list was built.";
    case "not-a-checkbox":
      return "That line isn't a checkbox anymore.";
  }
}

/** The service slice this group acts through. Narrowed to the METHODS used
 * (not the two manager classes wholesale) so the guarded-toggle contract can
 * be driven against fakes — a class instance carries private fields nothing
 * outside it can supply. `HostServices` satisfies it. */
type KnowledgeHandlerServices = {
  knowledge: Pick<
    HostServices["knowledge"],
    | "backlinks"
    | "forwardLinks"
    | "graph"
    | "notesWithTag"
    | "refresh"
    | "search"
    | "tasks"
    | "wikiTargets"
  >;
  vault: Pick<HostServices["vault"], "readText" | "writeText">;
};

export function registerKnowledgeHandlers(
  handle: HandlerRegistrar,
  services: KnowledgeHandlerServices,
): void {
  handle("getBacklinks", ({ path }) => services.knowledge.backlinks(path));
  handle("getForwardLinks", ({ path }) => services.knowledge.forwardLinks(path));
  // Assembly is whole-vault (the index has no cheaper way to know the totals
  // it reports); the BOUND is what keeps the reply off the wire.
  handle("getLinkGraph", (bounds) => boundGraph(services.knowledge.graph(), bounds));
  handle("searchVault", ({ query, tag, limit }) => {
    const manager = services.knowledge;
    return searchVaultNotes(
      {
        notesWithTag: (name) => manager.notesWithTag(name),
        search: (text, max) => manager.search(text, max),
      },
      { limit: limit ?? SEARCH_DEFAULT_LIMIT, query, tag },
    );
  });
  handle("listWikiTargets", () => services.knowledge.wikiTargets());
  handle("listVaultTasks", () => services.knowledge.tasks());
  // The guarded toggle: read → ordinal-locate + raw-equality guard → atomic
  // write (the open-note watcher and save notifiers broadcast normally). ANY
  // refusal means the projection the renderer acted on was stale — kick a
  // refresh so it self-heals, return the reason, and never write.
  handle("toggleVaultTask", ({ path, ordinal, expectedRaw }): ToggleTaskResult => {
    const vault = services.vault;
    let source: string;
    try {
      source = vault.readText(path);
    } catch (err) {
      void services.knowledge.refresh();
      return {
        ok: false,
        reason: "line-missing",
        error: `Couldn't read ${path}: ${toErrorMessage(err)}`,
      };
    }
    const result = toggleTaskAtOrdinal(source, ordinal, expectedRaw);
    if (!result.ok) {
      void services.knowledge.refresh();
      return { ok: false, reason: result.reason, error: toggleFailureMessage(result.reason) };
    }
    vault.writeText(path, result.content);
    return { ok: true, checked: result.checked };
  });
}
