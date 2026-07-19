// ---------------------------------------------------------------------------
// Rename + link rewrite: renames a vault file and rewrites every link that
// pointed at it (core's computeRenameEdits does the pure span surgery).
//
// Safety model — snapshot, rename, verify, write:
//   1. snapshot every doc BEFORE the rename (edits are computed from these
//      exact bytes, so index staleness can't corrupt a file);
//   2. perform the fs rename (the source of truth — if it fails, nothing is
//      rewritten);
//   3. per edited doc, re-read and only write when the file still matches the
//      snapshot — a concurrent edit (agent, user's other tool) wins and that
//      doc is skipped with a warning rather than clobbered.
// Writes go through VaultManager's atomic writeText, so the watcher fires the
// standard vault-changed broadcast and open editors + the knowledge index
// refresh through the normal path.
//
// Phase 3 — alias recording: when a doc's basename STEM changes (not a
// dir-only move, not a case-only retitle), the old stem is recorded in the
// moved doc's frontmatter `aliases:` (byte-preserving addFrontmatterAlias;
// skipped when it returns null — duplicate alias or unreadable frontmatter).
// This runs even when rewrite targets were skipped by the concurrent-edit
// guard: those skipped stale links are exactly what the alias keeps
// resolving. Folded into the moved doc's own rewrite when one exists, else
// written separately under the same snapshot-verify rule.
// ---------------------------------------------------------------------------

import { isDocPath } from "@repo/domain/knowledge/doc-file";
import { titleFromPath } from "@repo/domain/knowledge/link-extract";
import { computeRenameEdits } from "@repo/domain/knowledge/rename-links";
import { addFrontmatterAlias } from "@repo/domain/markdown/frontmatter";

import type { VaultManager } from "../vault/vault";

/** `docsRewritten` counts the docs the rewrite loop actually wrote — the
 * notes whose links were retargeted (a standalone alias-only write on the
 * moved doc is not a link rewrite and is not counted). */
export function renameWithLinkRewrite(
  vault: VaultManager,
  from: string,
  to: string,
): { ok: true; docsRewritten: number } | { ok: false; error: string } {
  // Snapshot before the rename; a failure here degrades to a plain rename.
  let snapshot: { docs: Map<string, string>; files: string[] } | null = null;
  try {
    const entries = vault.list();
    const docs = new Map<string, string>();
    for (const entry of entries) {
      if (entry.kind !== "doc") continue;
      try {
        docs.set(entry.path, vault.readText(entry.path));
      } catch {
        // Unreadable doc: leave it out — it simply won't be rewritten.
      }
    }
    snapshot = { docs, files: entries.map((entry) => entry.path) };
  } catch (err) {
    console.warn("[knowledge] vault snapshot before rename failed:", err);
  }

  const result = vault.rename(from, to);
  if (!result.ok) return result;
  if (snapshot === null) return { ok: true, docsRewritten: 0 };

  // Phase 3 precondition: record the old stem as an alias only for a doc
  // whose resolvable NAME actually changed — never for dir-only moves (stem
  // unchanged) or case-only retitles (ci-equal; the old spelling still
  // resolves via the ci tiers).
  const oldStem = titleFromPath(from);
  const recordAlias =
    isDocPath(from) &&
    isDocPath(to) &&
    oldStem !== "" &&
    oldStem.toLowerCase() !== titleFromPath(to).toLowerCase();

  let docsRewritten = 0;
  try {
    const edits = computeRenameEdits(snapshot.docs, snapshot.files, from, to);
    for (const [postPath, content] of edits) {
      // The moved doc's own edit is keyed at `to`; its snapshot sits at `from`.
      const prePath = postPath === to ? from : postPath;
      const expected = snapshot.docs.get(prePath);
      let current: string;
      try {
        current = vault.readText(postPath);
      } catch {
        continue; // vanished since the snapshot — nothing to rewrite
      }
      if (current !== expected) {
        console.warn(`[knowledge] ${postPath} changed during rename — links not rewritten`);
        continue;
      }
      // Fold the alias into the moved doc's own rewrite — one write, and the
      // whole rename batch lands as one logical change for sync/history.
      const next =
        recordAlias && postPath === to
          ? (addFrontmatterAlias(content, oldStem) ?? content)
          : content;
      vault.writeText(postPath, next);
      docsRewritten++;
    }
    if (recordAlias && !edits.has(to)) {
      // No rewrite touched the moved doc — read it, snapshot-verify (its
      // bytes moved verbatim from `from`), and write the alias alone.
      recordAliasStandalone(vault, to, snapshot.docs.get(from), oldStem);
    }
  } catch (err) {
    // The rename itself succeeded and is reported as such; a rewrite failure
    // leaves stale links (repairable), never inconsistent views.
    console.warn("[knowledge] link rewrite after rename failed:", err);
  }
  return { ok: true, docsRewritten };
}

function recordAliasStandalone(
  vault: VaultManager,
  to: string,
  expected: string | undefined,
  oldStem: string,
): void {
  let current: string;
  try {
    current = vault.readText(to);
  } catch {
    return; // vanished since the rename — nothing to record on
  }
  if (expected === undefined || current !== expected) {
    console.warn(`[knowledge] ${to} changed during rename — old-title alias not recorded`);
    return;
  }
  const withAlias = addFrontmatterAlias(current, oldStem);
  if (withAlias !== null) vault.writeText(to, withAlias);
}
