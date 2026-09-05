// the order is the safety model: snapshot the candidates, move the file, then
// rewrite each through writeIfUnchanged (a doc that changed under the rename
// loses its rewrite, never its content), then record the old stem as an alias
// so any link the surgery missed or skipped still resolves.

import { docStem, isDocPath } from "@repo/notes/knowledge/doc-file";
import { computeRenameEdits } from "@repo/notes/knowledge/rename-links";
import { addFrontmatterAlias } from "@repo/notes/markdown/frontmatter";
import type { VaultRenameResponse } from "@repo/api/local/vault/vault-schema";
import { snapshotDocs } from "./snapshot-docs";
import { normalizeVaultPath } from "@repo/notes/knowledge/vault-path";
import type { VaultService } from "../vault/vault-service";
import type { KnowledgeRuntime } from "./knowledge-runtime";

export interface RenameNoteArgs {
  service: VaultService;
  knowledge: KnowledgeRuntime;
  rebindThreads: (from: string, to: string) => void;
  from: string;
  to: string;
}

export async function renameNoteWithLinkRewrite(
  args: RenameNoteArgs,
): Promise<VaultRenameResponse> {
  const { service, knowledge } = args;
  const toPath = normalizeVaultPath(args.to);
  const requested = normalizeVaultPath(args.from);

  const tree = await service.listTree();
  // canonicalize against the listing: on a case-insensitive fs the caller may
  // spell note.md for a stored Note.md, and links resolve to the stored spelling.
  const source =
    tree.entries.find((entry) => entry.path === requested) ??
    tree.entries.find((entry) => entry.path.toLowerCase() === requested.toLowerCase());
  if (source === undefined || source.kind !== "file") {
    const plain = await service.rename(requested, toPath);
    args.rebindThreads(requested, plain.path);
    return { path: plain.path, rewritten: [], skipped: [] };
  }
  const fromPath = source.path;

  const candidates = (await knowledge.renameCandidates(fromPath, toPath)).filter(isDocPath);
  const { docs, skipped } = await snapshotDocs(service, candidates);
  const allFiles = tree.entries.filter((entry) => entry.kind === "file").map((entry) => entry.path);

  const renamed = await service.rename(fromPath, toPath);
  args.rebindThreads(fromPath, renamed.path);

  // a case-only retitle records nothing: the old spelling still resolves through the case-insensitive tiers.
  const oldStem = docStem(fromPath);
  const recordAlias =
    isDocPath(fromPath) &&
    isDocPath(renamed.path) &&
    oldStem !== "" &&
    oldStem.toLowerCase() !== docStem(renamed.path).toLowerCase();

  const edits = computeRenameEdits(docs, allFiles, fromPath, renamed.path);
  const rewritten: string[] = [];
  let aliasRecorded = false;

  for (const [postPath, content] of edits) {
    // the moved doc's edit is keyed at `to`; its snapshot sits at `from`.
    const isMovedDoc = postPath === renamed.path;
    const snapshot = docs.get(isMovedDoc ? fromPath : postPath);
    if (snapshot === undefined) continue;
    const withAlias =
      recordAlias && isMovedDoc ? (addFrontmatterAlias(content, oldStem) ?? content) : content;
    const result = await service.writeIfUnchanged(postPath, snapshot, withAlias);
    if (result.applied) {
      rewritten.push(postPath);
      if (isMovedDoc) aliasRecorded = true;
    } else {
      skipped.push({ path: postPath, reason: result.reason });
    }
  }

  if (recordAlias && !aliasRecorded) {
    await recordAliasStandalone(service, renamed.path, oldStem);
  }
  return { path: renamed.path, rewritten, skipped };
}

// a concurrent edit in the window loses the alias, never its content.
async function recordAliasStandalone(
  service: VaultService,
  to: string,
  oldStem: string,
): Promise<void> {
  try {
    const current = (await service.read(to)).content;
    const withAlias = addFrontmatterAlias(current, oldStem);
    if (withAlias !== null) await service.writeIfUnchanged(to, current, withAlias);
  } catch {
    // losing the fallback alias never fails the rename.
  }
}
