// Rename + link rewrite — the user-facing rename, over the vault service's
// rename primitive.
//
// The byte surgery is NOT reimplemented here: `computeRenameEdits` and
// `addFrontmatterAlias` are pure and platform-neutral by package contract, so
// the spans this host rewrites are the ones @repo/notes computes and tests.
// What this module owns is the ORDER, and the order is the safety model:
//
//   1. ask the knowledge index which docs this rename can possibly touch, and
//      snapshot THOSE before the move — edits are computed from those exact
//      bytes, so a stale read can never corrupt a file;
//   2. move the file — the source of truth. If it fails, nothing is rewritten;
//   3. write each edit only if the doc still holds its snapshot bytes. A doc
//      that changed under the rename loses its rewrite rather than its
//      content. (The compare-then-write window is unguarded — local-first
//      single-writer usage makes it a non-event, same stance as the service's
//      own directory rename.)
//   4. record the old stem as a frontmatter alias on the moved doc — the
//      fallback for any link the surgery missed, so it runs even when no
//      rewrite touched the moved doc.
//
// Every write goes through the vault service, so git, the watcher's echo
// suppression, the notifier and the knowledge projection all see ordinary
// writes. Directory renames pass straight through: the engine's surgery is
// per-file, and a folder move keeps every file's basename resolvable.

import { isDocPath } from "@repo/notes/knowledge/doc-file";
import { titleFromPath } from "@repo/notes/knowledge/link-extract";
import { computeRenameEdits } from "@repo/notes/knowledge/rename-links";
import { addFrontmatterAlias } from "@repo/notes/markdown/frontmatter";
import { normalizeVaultPath } from "../vault/vault-paths";
import type { VaultService } from "../vault/vault-service";
import type { KnowledgeRuntime } from "./knowledge-runtime";

export interface RenameNoteArgs {
  service: VaultService;
  knowledge: KnowledgeRuntime;
  from: string;
  to: string;
}

export async function renameNoteWithLinkRewrite(args: RenameNoteArgs): Promise<{ path: string }> {
  const { service, knowledge } = args;
  const toPath = normalizeVaultPath(args.to);
  const requested = normalizeVaultPath(args.from);

  const tree = await service.listTree();
  // Canonicalize against the LISTING: on a case-insensitive filesystem the
  // caller may spell `note.md` for a stored `Note.md`, and every link in the
  // vault resolves to the stored spelling — surgery over the raw request would
  // rewrite nothing at all.
  const source =
    tree.entries.find((entry) => entry.path === requested) ??
    tree.entries.find((entry) => entry.path.toLowerCase() === requested.toLowerCase());
  if (source === undefined || source.kind !== "file") {
    return service.rename(requested, toPath);
  }
  const fromPath = source.path;

  const candidates = await knowledge.renameCandidates(fromPath, toPath);
  const docs = new Map<string, string>();
  for (const candidate of candidates) {
    if (!isDocPath(candidate)) continue;
    try {
      docs.set(candidate, (await service.read(candidate)).content);
    } catch {
      // A candidate that cannot be read (vanished, over the cap) is simply
      // not rewritten; the recorded alias below still covers its links.
    }
  }
  const allFiles = tree.entries.filter((entry) => entry.kind === "file").map((entry) => entry.path);

  const renamed = await service.rename(fromPath, toPath);

  // Record the old stem only when the resolvable NAME actually changed — never
  // for a dir-only move (stem unchanged) or a case-only retitle (the old
  // spelling still resolves through the case-insensitive tiers).
  const oldStem = titleFromPath(fromPath);
  const recordAlias =
    isDocPath(fromPath) &&
    isDocPath(renamed.path) &&
    oldStem !== "" &&
    oldStem.toLowerCase() !== titleFromPath(renamed.path).toLowerCase();

  const edits = computeRenameEdits(docs, allFiles, fromPath, renamed.path);

  for (const [postPath, content] of edits) {
    // The moved doc's own edit is keyed at `to`; its snapshot sits at `from`.
    const isMovedDoc = postPath === renamed.path;
    const snapshot = docs.get(isMovedDoc ? fromPath : postPath);
    if (snapshot === undefined) continue;
    if (!(await holdsSnapshotBytes(service, postPath, snapshot))) continue;
    const next =
      recordAlias && isMovedDoc ? (addFrontmatterAlias(content, oldStem) ?? content) : content;
    await service.write(postPath, next);
  }

  if (recordAlias && !edits.has(renamed.path)) {
    await recordAliasStandalone(service, renamed.path, oldStem);
  }
  return renamed;
}

async function holdsSnapshotBytes(
  service: VaultService,
  path: string,
  snapshot: string,
): Promise<boolean> {
  try {
    return (await service.read(path)).content === snapshot;
  } catch {
    return false;
  }
}

/** No rewrite touched the moved doc, so the alias is written on its own. */
async function recordAliasStandalone(
  service: VaultService,
  to: string,
  oldStem: string,
): Promise<void> {
  try {
    const current = (await service.read(to)).content;
    const withAlias = addFrontmatterAlias(current, oldStem);
    if (withAlias !== null) await service.write(to, withAlias);
  } catch {
    // The alias is a fallback; losing it never fails the rename.
  }
}
