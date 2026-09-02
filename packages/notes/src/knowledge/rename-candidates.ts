import type { LinkKind } from "./link-extract";
import type { WikiTarget } from "./link-graph-index";
import { buildResolver } from "./link-resolve";
import { normalizePath } from "./vault-path";

export type RenameCandidateGraph = {
  backlinks(path: string): ReadonlyArray<{ sourcePath: string }>;
  forwardLinks(path: string): ReadonlyArray<{ kind: LinkKind; target: string }>;
  wikiTargets(): readonly WikiTarget[];
};

// a superset computed with no reads: the moved doc, its backlinks, and the shadow
// population — every doc whose link would resolve to `to` afterwards (a rename to
// `note.md` steals `[[note]]` from `a/note.md`), alias entries included
export function renameCandidates(graph: RenameCandidateGraph, from: string, to: string): string[] {
  const fromPath = normalizePath(from);
  const toPath = normalizePath(to);
  const candidates = new Set<string>([fromPath]);
  for (const entry of graph.backlinks(fromPath)) candidates.add(entry.sourcePath);

  const targets = graph.wikiTargets();
  const postPathOf = (path: string): string => (path === fromPath ? toPath : path);
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
    if (target.type !== "doc" || candidates.has(target.path)) continue;
    const sourcePost = postPathOf(target.path);
    for (const link of graph.forwardLinks(target.path)) {
      const hit =
        link.kind === "wiki"
          ? postResolver.resolveWiki(link.target)
          : postResolver.resolveMd(link.target, sourcePost);
      if (hit === toPath) {
        candidates.add(target.path);
        break;
      }
    }
  }
  return [...candidates];
}
