import type { LinkKind } from "./link-kinds";
import type { WikiTarget } from "./link-graph-index";
import { buildResolver } from "./link-resolve";
import { normalizePath } from "./vault-path";

export interface RenameCandidateGraph {
  backlinks: (path: string) => readonly { sourcePath: string }[];
  forwardLinks: (path: string) => readonly { kind: LinkKind; target: string }[];
  wikiTargets: () => readonly WikiTarget[];
}

// a superset computed with no reads, over `computeMoveEdits`' moves: every moved doc, their
// backlinks, and the shadow population — every doc whose link would resolve to a moved file
// afterwards (a rename to `note.md` steals `[[note]]` from `a/note.md`), alias entries included
export const moveCandidates = (
  graph: RenameCandidateGraph,
  moves: ReadonlyMap<string, string>,
): string[] => {
  const normalizedMoves = new Map(
    [...moves].map(([from, to]): readonly [string, string] => [
      normalizePath(from),
      normalizePath(to),
    ]),
  );
  const candidates = new Set<string>(normalizedMoves.keys());
  for (const from of normalizedMoves.keys()) {
    for (const entry of graph.backlinks(from)) {
      candidates.add(entry.sourcePath);
    }
  }

  const targets = graph.wikiTargets();
  const postPathOf = (path: string): string => normalizedMoves.get(path) ?? path;
  const movedTo = new Set(normalizedMoves.values());
  const aliasEntries = targets.flatMap((target) =>
    (target.aliases ?? []).map((alias): readonly [string, string] => [
      alias,
      postPathOf(target.path),
    ]),
  );
  const postResolver = buildResolver(
    targets.map((target) => postPathOf(target.path)),
    aliasEntries,
  );

  for (const target of targets) {
    if (target.type !== "doc" || candidates.has(target.path)) {
      continue;
    }
    const sourcePost = postPathOf(target.path);
    for (const link of graph.forwardLinks(target.path)) {
      const hit =
        link.kind === "wiki"
          ? postResolver.resolveWiki(link.target)
          : postResolver.resolveMd(link.target, sourcePost);
      if (hit !== null && movedTo.has(hit)) {
        candidates.add(target.path);
        break;
      }
    }
  }
  return [...candidates];
};
