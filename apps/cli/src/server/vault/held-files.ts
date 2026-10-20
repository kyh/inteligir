// Which deleted file a deleted doc held: an item's original, its cover and its page copy leave
// with the item in one change set, so Deleted lists the file under the doc and a restore of the
// doc brings it back. A file is held by a doc deleted in the same change set that links or embeds
// it, resolved as the doc's own links resolve, against the files that change set deleted.

import type { ExtractedLink } from "@repo/notes/knowledge/link-extract";
import { buildResolver } from "@repo/notes/knowledge/link-resolve";

export interface DeletedPath {
  path: string;
  kind: "doc" | "file";
  // the change set that deleted it: the deleting commit, or the worktree's own for a deletion
  // not yet committed
  group: string;
}

const resolveIn = (
  resolver: ReturnType<typeof buildResolver>,
  link: ExtractedLink,
  docPath: string,
): string | null =>
  link.kind === "wiki"
    ? resolver.resolveWiki(link.target, link.alias)
    : resolver.resolveMd(link.target, docPath);

// the doc each held file was linked by, keyed by the file's path; a file two deleted docs link is
// held by the first in path order, so the answer does not depend on the log's order
export const heldByDoc = (
  deleted: readonly DeletedPath[],
  linksOf: (docPath: string) => readonly ExtractedLink[],
): Map<string, string> => {
  const groups = new Map<string, { docs: string[]; files: string[] }>();
  for (const entry of deleted) {
    const group = groups.get(entry.group) ?? { docs: [], files: [] };
    (entry.kind === "doc" ? group.docs : group.files).push(entry.path);
    groups.set(entry.group, group);
  }
  const held = new Map<string, string>();
  for (const { docs, files } of groups.values()) {
    if (docs.length === 0 || files.length === 0) {
      continue;
    }
    const resolver = buildResolver(files);
    for (const doc of docs.toSorted()) {
      for (const link of linksOf(doc)) {
        const file = resolveIn(resolver, link, doc);
        if (file !== null && !held.has(file)) {
          held.set(file, doc);
        }
      }
    }
  }
  return held;
};
