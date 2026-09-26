// the order is the safety model: snapshot the candidates, move the entry, then
// rewrite each through writeIfUnchanged (a doc that changed under the rename
// loses its rewrite, never its content), then record a renamed note's old stem
// as an alias so any link the surgery missed or skipped still resolves. A folder
// is the same set over every file under it, and records no alias: its moves keep
// every name. The moves, the alias and the writes are @repo/notes/knowledge/plan-rename,
// which the phone plans its renames with too; the guards are this file's.

import { isDocPath } from "@repo/notes/knowledge/doc-file";
import { resolverEntriesOf } from "@repo/notes/knowledge/link-graph-index";
import { movesOf, renameAlias, renameWrites } from "@repo/notes/knowledge/plan-rename";
import { addFrontmatterAlias } from "@repo/notes/markdown/frontmatter";
import type { VaultRenameResponse } from "@repo/api/local/vault/vault-schema";
import { snapshotDocs } from "./snapshot-docs";
import { normalizeVaultPath } from "@repo/notes/knowledge/vault-path";
import type { VaultService } from "../vault/vault-service";
import type { KnowledgeRuntime } from "./knowledge-runtime";

export interface RenameNoteArgs {
  service: VaultService;
  knowledge: KnowledgeRuntime;
  from: string;
  to: string;
}

// a concurrent edit in the window loses the alias, never its content.
const recordAliasStandalone = async (
  service: VaultService,
  to: string,
  oldStem: string,
): Promise<void> => {
  try {
    const { content: current } = await service.read(to);
    const withAlias = addFrontmatterAlias(current, oldStem);
    if (withAlias !== null) {
      await service.writeIfUnchanged(to, current, withAlias);
    }
  } catch {
    // losing the fallback alias never fails the rename.
  }
};

export const renameNoteWithLinkRewrite = async (
  args: RenameNoteArgs,
): Promise<VaultRenameResponse> => {
  const { service, knowledge } = args;
  const toPath = normalizeVaultPath(args.to);
  const requested = normalizeVaultPath(args.from);

  const tree = await service.listTree();
  // canonicalize against the listing: on a case-insensitive fs the caller may
  // spell note.md for a stored Note.md, and links resolve to the stored spelling.
  const source =
    tree.entries.find((entry) => entry.path === requested) ??
    tree.entries.find((entry) => entry.path.toLowerCase() === requested.toLowerCase());
  if (source === undefined) {
    const plain = await service.rename(requested, toPath);
    return { path: plain.path, rewritten: [], skipped: [] };
  }
  const fromPath = source.path;
  // the moves come from the same listing, so every moved file is one the resolvers know
  const allFiles = tree.entries.filter((entry) => entry.kind === "file").map((entry) => entry.path);

  const linkedDocs = await knowledge.renameCandidates(movesOf(source, allFiles, toPath));
  const { aliasEntries, idEntries } = resolverEntriesOf(await knowledge.wikiTargets());
  const candidates = linkedDocs.filter(isDocPath);
  const { docs, skipped } = await snapshotDocs(service, candidates);

  const renamed = await service.rename(fromPath, toPath);
  const moves = movesOf(source, allFiles, renamed.path);
  const alias = renameAlias(source, renamed.path);

  const edits = await knowledge.renameEdits({ aliasEntries, allFiles, docs, idEntries, moves });
  const rewritten: string[] = [];
  let aliasRecorded = false;

  for (const write of renameWrites({ alias, edits, moves, renamed: renamed.path })) {
    const snapshot = docs.get(write.from);
    if (snapshot === undefined) {
      continue;
    }
    const result = await service.writeIfUnchanged(write.path, snapshot, write.content);
    if (result.applied) {
      rewritten.push(write.path);
      if (write.renamedNote) {
        aliasRecorded = true;
      }
    } else {
      skipped.push({ path: write.path, reason: result.reason });
    }
  }

  if (alias !== null && !aliasRecorded) {
    await recordAliasStandalone(service, renamed.path, alias);
  }
  return { path: renamed.path, rewritten, skipped };
};
