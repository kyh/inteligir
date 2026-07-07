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
// ---------------------------------------------------------------------------

import { computeRenameEdits } from "@repo/core/knowledge/rename-links";

import type { VaultManager } from "../vault/vault";

export function renameWithLinkRewrite(
  vault: VaultManager,
  from: string,
  to: string,
): { ok: true } | { ok: false; error: string } {
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
  if (!result.ok || snapshot === null) return result;

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
      vault.writeText(postPath, content);
    }
  } catch (err) {
    // The rename itself succeeded and is reported as such; a rewrite failure
    // leaves stale links (repairable), never inconsistent views.
    console.warn("[knowledge] link rewrite after rename failed:", err);
  }
  return result;
}
