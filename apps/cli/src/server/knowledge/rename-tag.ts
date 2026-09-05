// the note rename's order: snapshot the candidates, then rewrite each through
// writeIfUnchanged, so a doc that changed under the rename loses its rewrite, never its
// content. Each write is the vault's own, so the auto-commit names the files.

import { computeTagRenameEdits } from "@repo/notes/knowledge/rename-tags";
import type { KnowledgeRenameTagResponse } from "@repo/api/local/knowledge/knowledge-schema";
import { snapshotDocs } from "./snapshot-docs";
import type { VaultService } from "../vault/vault-service";
import type { KnowledgeRuntime } from "./knowledge-runtime";

export interface RenameTagArgs {
  service: Pick<VaultService, "read" | "writeIfUnchanged">;
  knowledge: Pick<KnowledgeRuntime, "tagRenameCandidates">;
  from: string;
  to: string;
}

export async function renameTagAcrossVault(
  args: RenameTagArgs,
): Promise<KnowledgeRenameTagResponse> {
  const { service, knowledge, from, to } = args;
  const candidates = await knowledge.tagRenameCandidates(from);
  const { docs, skipped } = await snapshotDocs(service, candidates);

  const rewritten: string[] = [];
  for (const [path, content] of computeTagRenameEdits(docs, from, to)) {
    const snapshot = docs.get(path);
    if (snapshot === undefined) continue;
    const result = await service.writeIfUnchanged(path, snapshot, content);
    if (result.applied) {
      rewritten.push(path);
    } else {
      skipped.push({ path, reason: result.reason });
    }
  }
  return { from, to, rewritten, skipped };
}
