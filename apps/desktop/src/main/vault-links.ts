// The vault's wiki-link graph: for a given note, its outgoing links (resolved to
// files or flagged broken) and its backlinks (notes that link to it). Computed
// on demand from the current file contents — fine for typical vaults; a large
// vault would want a cached, incrementally-updated index (future).

import { getVaultManager } from "@/main/vault";
import {
  parseWikiLinks,
  resolveWikiTarget,
  type NoteLinks,
  type ResolvedWikiLink,
} from "@/shared/wiki-links";

type VaultDoc = { path: string; content: string };

/** Pure core: compute the link relationships for `targetPath` from a snapshot of
 * every markdown doc in the vault. Electron-free + deterministic for tests. */
export function computeNoteLinks(targetPath: string, docs: readonly VaultDoc[]): NoteLinks {
  const paths = docs.map((d) => d.path);

  const self = docs.find((d) => d.path === targetPath);
  const outgoing: ResolvedWikiLink[] = [];
  const seen = new Set<string>();
  for (const link of self ? parseWikiLinks(self.content) : []) {
    if (seen.has(link.target.toLowerCase())) continue;
    seen.add(link.target.toLowerCase());
    outgoing.push({
      target: link.target,
      alias: link.alias,
      path: resolveWikiTarget(link.target, paths),
    });
  }

  const backlinks: string[] = [];
  for (const doc of docs) {
    if (doc.path === targetPath) continue;
    if (!doc.content.includes("[[")) continue; // cheap skip
    const linksHere = parseWikiLinks(doc.content).some(
      (link) => resolveWikiTarget(link.target, paths) === targetPath,
    );
    if (linksHere) backlinks.push(doc.path);
  }

  return { outgoing, backlinks: backlinks.toSorted((a, b) => a.localeCompare(b)) };
}

/** Read every markdown doc in the live vault and compute `path`'s links. */
export function getNoteLinks(path: string): NoteLinks {
  const vault = getVaultManager();
  const docs: VaultDoc[] = [];
  for (const entry of vault.list()) {
    if (entry.kind !== "doc") continue;
    try {
      docs.push({ path: entry.path, content: vault.readText(entry.path) });
    } catch {
      // A file vanished between list and read — skip it.
    }
  }
  return computeNoteLinks(path, docs);
}
