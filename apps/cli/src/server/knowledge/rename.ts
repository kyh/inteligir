// Rename + link rewrite — the user-facing rename, over the vault service's
// rename primitive.
//
// The knowledge-domain logic is NOT implemented here: candidate selection
// (@repo/notes/knowledge/rename-candidates), the byte surgery
// (computeRenameEdits) and the alias writer (addFrontmatterAlias) are pure
// engine functions. What this module owns is the ORDER, and the order is the
// safety model:
//
//   1. ask the engine which docs this rename can possibly touch, and snapshot
//      THOSE before the move — edits are computed from those exact bytes;
//   2. move the file — the source of truth. If it fails, nothing is rewritten;
//   3. apply each edit through `writeIfUnchanged`, which re-reads and compares
//      INSIDE one turn of the vault's mutation lock — a doc that changed under
//      the rename loses its rewrite (reported as skipped), never its content.
//      An external editor writes outside that lock; the residue of that race
//      is accepted for a local-first single-writer vault.
//   4. record the old stem as a frontmatter alias on the moved doc — the
//      fallback for any link the surgery missed OR skipped, so it must never
//      be suppressed by an unrelated skip;
//   5. rebind the threads attached to the moved doc. A thread's
//      `originDocPath` is a link into the vault exactly like a wiki-link, and
//      it rots the same way: a rename that did not follow it leaves the
//      note's actions unable to find their note. It belongs here, in the one
//      operation that already knows both paths.
//
// Every write goes through the vault service, so git, the watcher's echo
// suppression, the notifier and the knowledge projection all see ordinary
// writes. Directory renames pass straight through: the engine's surgery is
// per-file, and a folder move keeps every file's basename resolvable.

import { docStem, isDocPath } from "@repo/notes/knowledge/doc-file";
import { computeRenameEdits } from "@repo/notes/knowledge/rename-links";
import { addFrontmatterAlias } from "@repo/notes/markdown/frontmatter";
import type {
  VaultRenameResponse,
  VaultRenameSkipReason,
} from "@repo/api/local/vault/vault-schema";
import { mapWithConcurrency } from "../concurrency";
import { normalizeVaultPath } from "@repo/notes/knowledge/vault-path";
import type { VaultService } from "../vault/vault-service";
import type { KnowledgeRuntime } from "./knowledge-runtime";

/** Snapshot reads in flight before the move; the rewrite that follows stays
 * strictly sequential (each write re-reads under the mutation lock). */
const SNAPSHOT_CONCURRENCY = 8;

export interface RenameNoteArgs {
  service: VaultService;
  knowledge: KnowledgeRuntime;
  /** Follows the moved path for every thread bound to it; see step 5. */
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
  // Canonicalize against the LISTING: on a case-insensitive filesystem the
  // caller may spell `note.md` for a stored `Note.md`, and every link in the
  // vault resolves to the stored spelling — surgery over the raw request would
  // rewrite nothing at all.
  const source =
    tree.entries.find((entry) => entry.path === requested) ??
    tree.entries.find((entry) => entry.path.toLowerCase() === requested.toLowerCase());
  if (source === undefined || source.kind !== "file") {
    // A directory move (or a path the listing does not know) still carries
    // every attached thread under it.
    const plain = await service.rename(requested, toPath);
    args.rebindThreads(requested, plain.path);
    return { path: plain.path, rewritten: [], skipped: [] };
  }
  const fromPath = source.path;

  const candidates = (await knowledge.renameCandidates(fromPath, toPath)).filter(isDocPath);
  // Snapshots are gathered with bounded concurrency and recorded IN CANDIDATE
  // ORDER: the rewrite below is order-sensitive, the filesystem is not.
  const snapshots = await mapWithConcurrency(candidates, SNAPSHOT_CONCURRENCY, async (candidate) =>
    service
      .read(candidate)
      .then((file) => file.content)
      .catch(() => null),
  );
  const docs = new Map<string, string>();
  const skipped: Array<{ path: string; reason: VaultRenameSkipReason }> = [];
  for (const [index, snapshot] of snapshots.entries()) {
    const candidate = candidates[index];
    if (candidate === undefined) continue;
    if (snapshot === null) {
      // A candidate that cannot be snapshotted (vanished, over the read cap)
      // is not rewritten; the recorded alias below still covers its links.
      skipped.push({ path: candidate, reason: "unreadable" });
      continue;
    }
    docs.set(candidate, snapshot);
  }
  const allFiles = tree.entries.filter((entry) => entry.kind === "file").map((entry) => entry.path);

  const renamed = await service.rename(fromPath, toPath);
  args.rebindThreads(fromPath, renamed.path);

  // Record the old stem only when the resolvable NAME actually changed — never
  // for a dir-only move (stem unchanged) or a case-only retitle (the old
  // spelling still resolves through the case-insensitive tiers).
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
    // The moved doc's own edit is keyed at `to`; its snapshot sits at `from`.
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

  // The alias is the fallback for everything skipped or missed, so it lands
  // even when the moved doc's own rewrite did not (or never existed).
  if (recordAlias && !aliasRecorded) {
    await recordAliasStandalone(service, renamed.path, oldStem);
  }
  return { path: renamed.path, rewritten, skipped };
}

/** Record the alias on the moved doc's CURRENT bytes; a concurrent edit in
 * the window loses the alias rather than its content. */
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
    // The alias is a fallback; losing it never fails the rename.
  }
}
