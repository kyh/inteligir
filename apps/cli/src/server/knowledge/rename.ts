// the order is the safety model: snapshot the candidates, move the entry, then
// rewrite each through writeIfUnchanged (a doc that changed under the rename
// loses its rewrite, never its content), then record a renamed note's old stem
// as an alias so any link the surgery missed or skipped still resolves. A folder
// is the same set over every file under it, and records no alias: its moves keep
// every name.

import { docStem, isDocPath } from "@repo/notes/knowledge/doc-file";
import { addFrontmatterAlias } from "@repo/notes/markdown/frontmatter";
import type { VaultEntry, VaultRenameResponse } from "@repo/api/local/vault/vault-schema";
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

// one move for a note, one per file under a folder
const movesOf = (source: VaultEntry, files: readonly string[], to: string): Map<string, string> => {
  if (source.kind === "file") {
    return new Map([[source.path, to]]);
  }
  const prefix = `${source.path}/`;
  return new Map(
    files
      .filter((file) => file.startsWith(prefix))
      .map((file): [string, string] => [file, `${to}/${file.slice(prefix.length)}`]),
  );
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
    args.rebindThreads(requested, plain.path);
    return { path: plain.path, rewritten: [], skipped: [] };
  }
  const fromPath = source.path;
  // the moves come from the same listing, so every moved file is one the resolvers know
  const allFiles = tree.entries.filter((entry) => entry.kind === "file").map((entry) => entry.path);

  const linkedDocs = await knowledge.renameCandidates(movesOf(source, allFiles, toPath));
  const targets = await knowledge.wikiTargets();
  const aliasEntries = targets.flatMap((target) =>
    (target.aliases ?? []).map((alias): readonly [string, string] => [alias, target.path]),
  );
  const candidates = linkedDocs.filter(isDocPath);
  const { docs, skipped } = await snapshotDocs(service, candidates);

  const renamed = await service.rename(fromPath, toPath);
  args.rebindThreads(fromPath, renamed.path);
  const moves = movesOf(source, allFiles, renamed.path);

  // a case-only retitle records nothing: the old spelling still resolves through the case-insensitive tiers.
  const oldStem = docStem(fromPath);
  const recordAlias =
    source.kind === "file" &&
    isDocPath(fromPath) &&
    isDocPath(renamed.path) &&
    oldStem !== "" &&
    oldStem.toLowerCase() !== docStem(renamed.path).toLowerCase();

  const edits = await knowledge.renameEdits({ aliasEntries, allFiles, docs, moves });
  // a moved doc's edit is keyed at its new path; its snapshot sits at the old one.
  const movedFrom = new Map([...moves].map(([from, to]): [string, string] => [to, from]));
  const rewritten: string[] = [];
  let aliasRecorded = false;

  for (const [postPath, content] of edits) {
    const snapshot = docs.get(movedFrom.get(postPath) ?? postPath);
    if (snapshot === undefined) {
      continue;
    }
    const isRenamedNote = postPath === renamed.path;
    const withAlias =
      recordAlias && isRenamedNote ? (addFrontmatterAlias(content, oldStem) ?? content) : content;
    const result = await service.writeIfUnchanged(postPath, snapshot, withAlias);
    if (result.applied) {
      rewritten.push(postPath);
      if (isRenamedNote) {
        aliasRecorded = true;
      }
    } else {
      skipped.push({ path: postPath, reason: result.reason });
    }
  }

  if (recordAlias && !aliasRecorded) {
    await recordAliasStandalone(service, renamed.path, oldStem);
  }
  return { path: renamed.path, rewritten, skipped };
};
