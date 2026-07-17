import { toggleTaskAtOrdinal } from "@repo/core/knowledge/guarded-line-edit";
import { toErrorMessage } from "@repo/features/ipc";
import type { ToggleTaskResult } from "@repo/features/ipc-registry";

import { getKnowledgeManager } from "../knowledge/knowledge-manager";
import { getVaultManager } from "../vault/vault";
import type { HandlerRegistrar } from "../lib/handler-registry";

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
  handle("getLinkGraph", () => getKnowledgeManager().graph());
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
