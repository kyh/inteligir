// ---------------------------------------------------------------------------
// The knowledge index's seven Bridge handlers, over this object's own index.
//
// Every one of them is a thin await around ./knowledge/user-knowledge. The
// composition a host could get wrong — text ∧ tag search, the guarded toggle —
// is core's and is called unmodified, so the host cannot rank or refuse
// differently from the client reading the same index.
// ---------------------------------------------------------------------------

import type { ToggleTaskResult } from "@repo/bridge/knowledge";
import { toErrorMessage } from "@repo/bridge/wire-helpers";
import { toggleTaskAtOrdinal } from "@repo/notes/knowledge/guarded-line-edit";

import type { HandlerRegistrar } from "./handler-registry";
import type { UserKnowledge } from "./knowledge/user-knowledge";
import type { UserVault } from "./vault/user-vault";

/** What a refused toggle says, per reason (the raw reason rides along for the
 * client's own branching). */
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

export function registerKnowledgeHandlers(
  handle: HandlerRegistrar,
  knowledge: UserKnowledge,
  vault: UserVault,
): void {
  handle("getBacklinks", ({ path }) => knowledge.backlinks(path));
  handle("getForwardLinks", ({ path }) => knowledge.forwardLinks(path));
  handle("getLinkGraph", (bounds) => knowledge.linkGraph(bounds));
  handle("searchVault", (params) => knowledge.search(params));
  handle("listWikiTargets", () => knowledge.wikiTargets());
  handle("listVaultTasks", () => knowledge.tasks());

  // The guarded toggle: read → ordinal-locate + raw-byte equality → write. ANY
  // refusal means the projection the client acted on was stale, so it kicks an
  // index self-heal, reports the reason, and never writes.
  handle("toggleVaultTask", async ({ path, ordinal, expectedRaw }): Promise<ToggleTaskResult> => {
    let source: string;
    try {
      source = await vault.readText(path);
    } catch (err) {
      knowledge.heal();
      return {
        ok: false,
        reason: "line-missing",
        error: `Couldn't read ${path}: ${toErrorMessage(err)}`,
      };
    }
    const result = toggleTaskAtOrdinal(source, ordinal, expectedRaw);
    if (!result.ok) {
      knowledge.heal();
      return { ok: false, reason: result.reason, error: toggleFailureMessage(result.reason) };
    }
    const written = await vault.writeText(path, result.content);
    // Unconditional, so the only refusal left is a path that does not name a
    // file inside the vault — which this one already read.
    if (!written.ok) throw new Error(`Could not write ${path}`);
    return { ok: true, checked: result.checked };
  });
}
