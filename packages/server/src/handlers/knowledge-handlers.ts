import { toggleTaskAtOrdinal } from "@repo/notes/knowledge/guarded-line-edit";
import { boundGraph } from "@repo/notes/knowledge/link-graph-index";
import { toErrorMessage } from "@repo/bridge/wire-helpers";
import type { ToggleTaskResult } from "@repo/bridge/ipc-registry";

import { getKnowledgeManager } from "../knowledge/knowledge-manager";
import { getVaultManager } from "@repo/vault/vault";
import type { HandlerRegistrar } from "./handler-registry";

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

export function registerKnowledgeHandlers(handle: HandlerRegistrar): void {
  handle("getBacklinks", ({ path }) => getKnowledgeManager().backlinks(path));
  handle("getForwardLinks", ({ path }) => getKnowledgeManager().forwardLinks(path));
  handle("getRelatedNotes", ({ path }) => getKnowledgeManager().relatedNotes(path));
  // Assembly is whole-vault (the index has no cheaper way to know the totals
  // it reports); the BOUND is what keeps the reply off the wire.
  handle("getLinkGraph", (bounds) => boundGraph(getKnowledgeManager().graph(), bounds));
  handle("searchVault", ({ query, limit }) => getKnowledgeManager().search(query, limit));
  handle("listWikiTargets", () => getKnowledgeManager().wikiTargets());
  handle("listTags", () => getKnowledgeManager().tags());
  handle("getNotesByTag", ({ tag }) => getKnowledgeManager().notesWithTag(tag));
  handle("listVaultTasks", () => getKnowledgeManager().tasks());
  // The guarded toggle: read → ordinal-locate + raw-equality guard → atomic
  // write (the open-note watcher and save notifiers broadcast normally). ANY
  // refusal means the projection the renderer acted on was stale — kick a
  // refresh so it self-heals, return the reason, and never write.
  handle("toggleVaultTask", ({ path, ordinal, expectedRaw }): ToggleTaskResult => {
    const vault = getVaultManager();
    let source: string;
    try {
      source = vault.readText(path);
    } catch (err) {
      void getKnowledgeManager().refresh();
      return {
        ok: false,
        reason: "line-missing",
        error: `Couldn't read ${path}: ${toErrorMessage(err)}`,
      };
    }
    const result = toggleTaskAtOrdinal(source, ordinal, expectedRaw);
    if (!result.ok) {
      void getKnowledgeManager().refresh();
      return { ok: false, reason: result.reason, error: toggleFailureMessage(result.reason) };
    }
    vault.writeText(path, result.content);
    return { ok: true, checked: result.checked };
  });
}
