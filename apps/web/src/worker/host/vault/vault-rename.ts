// ---------------------------------------------------------------------------
// Rename + link rewrite — the user-facing rename, over the vault's `move`
// primitive.
//
// The byte surgery is NOT reimplemented here: `computeRenameEdits` and
// `addFrontmatterAlias` are pure and platform-neutral by package contract, so
// the cloud rewrites exactly the spans the desktop rewrites. What this module
// owns is the ORDER, and the order is the safety model:
//
//   1. ask the knowledge index which docs this rename can possibly touch, and
//      snapshot THOSE before the move (edits are computed from those exact
//      bytes, so a stale read can never corrupt a file);
//   2. move the file — the source of truth. If it fails, nothing is rewritten;
//   3. write each edit CONDITIONALLY, at the version its snapshot was read at.
//      A doc that changed under the rename loses its rewrite rather than its
//      content — the same verdict the desktop reaches by comparing bytes,
//      reached here by comparing versions, because the manifest already knows.
//   4. record the old stem as a frontmatter alias on the moved doc.
//
// Step 4 is the fallback the surgery leans on, which is why it runs even when
// rewrites were skipped or never computed: a link the rewrite missed still
// resolves through the alias.
//
// Both paths are canonicalized against the MANIFEST before any of this. The
// vault is case-insensitive, so a caller may name `note.md` for a file stored
// as `Note.md` — and every link in the vault resolves to the stored spelling.
// Handing the raw request straight to the pure pass would compute a rename of a
// path no link points at, and rewrite nothing at all.
// ---------------------------------------------------------------------------

import { isDocPath } from "@repo/notes/knowledge/doc-file";
import { titleFromPath } from "@repo/notes/knowledge/link-extract";
import { checkNoteName, noteNameErrorMessage } from "@repo/notes/knowledge/note-name";
import { computeRenameEdits } from "@repo/notes/knowledge/rename-links";
import { basenamePath } from "@repo/notes/knowledge/vault-path";
import { addFrontmatterAlias } from "@repo/notes/markdown/frontmatter";

import type { UserKnowledge } from "../knowledge/user-knowledge";
import type { UserVault } from "./user-vault";
import { parseVaultPath } from "./vault-key";

export async function renameWithLinkRewrite(
  vault: UserVault,
  knowledge: UserKnowledge,
  rawFrom: string,
  rawTo: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const source = vault.lookup(rawFrom);
  if (source === null || source.state !== "live")
    return { ok: false, error: `Not found: ${rawFrom}` };
  const target = parseVaultPath(rawTo);
  if (target === null) return { ok: false, error: `Invalid path: ${rawTo}` };
  // Boundary enforcement of the note-name ruleset. Only the destination
  // BASENAME is checked; directory moves pass through. Plain writes are
  // deliberately NOT gated — a pre-existing file with a hostile name must keep
  // saving.
  const verdict = checkNoteName(basenamePath(target.path));
  if (!verdict.ok) return { ok: false, error: noteNameErrorMessage(verdict.reason) };

  const from = source.path;
  const to = target.path;
  const snapshot = await vault.snapshotDocs(await knowledge.renameCandidates(from, to));
  const moved = await vault.move(from, to);
  if (!moved.ok) return moved;

  // Record the old stem only when the resolvable NAME actually changed — never
  // for a dir-only move (stem unchanged) or a case-only retitle (the old
  // spelling still resolves through the case-insensitive tiers).
  const oldStem = titleFromPath(from);
  const recordAlias =
    isDocPath(from) &&
    isDocPath(to) &&
    oldStem !== "" &&
    oldStem.toLowerCase() !== titleFromPath(to).toLowerCase();

  const edits = computeRenameEdits(snapshot.docs, snapshot.files, from, to);

  for (const [postPath, content] of edits) {
    // The moved doc's own edit is keyed at `to`; its snapshot sits at `from`,
    // and the move already bumped its version by one.
    const isMovedDoc = postPath === to;
    const baseVersion = snapshot.versions.get(isMovedDoc ? from : postPath);
    if (baseVersion === undefined) continue;
    const next =
      recordAlias && isMovedDoc ? (addFrontmatterAlias(content, oldStem) ?? content) : content;
    await vault.writeText(postPath, next, isMovedDoc ? baseVersion + 1 : baseVersion);
  }

  if (recordAlias && !edits.has(to)) await recordAliasStandalone(vault, to, oldStem);
  return { ok: true };
}

/** No rewrite touched the moved doc, so the alias is written on its own —
 * read-then-write-at-that-version, so a concurrent edit loses the alias rather
 * than its content. */
async function recordAliasStandalone(vault: UserVault, to: string, oldStem: string): Promise<void> {
  const current = vault.lookup(to);
  if (current === null || current.state !== "live") return;
  const withAlias = addFrontmatterAlias(await vault.readText(to), oldStem);
  if (withAlias !== null) await vault.writeText(to, withAlias, current.version);
}
