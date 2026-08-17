// ---------------------------------------------------------------------------
// Rename candidates — which docs a `from` → `to` rename may have to rewrite.
// The selection policy is knowledge-domain logic and lives HERE, beside the
// byte surgery it feeds (rename-links.ts): a host shell asks this one
// question over its in-memory graph and then reads only the named docs,
// however large the vault is.
// ---------------------------------------------------------------------------

import type { LinkKind } from "./link-extract";
import type { WikiTarget } from "./link-graph-index";
import { buildResolver } from "./link-resolve";
import { normalizePath } from "./vault-path";

/** The three graph reads the selection needs — structurally satisfied by
 * LinkGraphIndex and KnowledgeIndex alike. */
export type RenameCandidateGraph = {
  backlinks(path: string): ReadonlyArray<{ sourcePath: string }>;
  forwardLinks(path: string): ReadonlyArray<{ kind: LinkKind; target: string }>;
  wikiTargets(): readonly WikiTarget[];
};

/**
 * The docs a `from` → `to` rename may have to rewrite — a SUPERSET of the
 * ones that actually change, computed with no reads at all.
 *
 * Three populations, and only the first two are what "who links here?" means:
 *
 *   1. the moved doc itself (self-links, and its own relative urls re-base
 *      when it changes directory);
 *   2. every doc holding a link that resolves to `from` today — the graph's
 *      backlinks, exactly;
 *   3. every doc holding a link that would resolve to `to` AFTERWARDS. This
 *      is the shadow population, and it is why the answer is not just
 *      backlinks: a rename to `note.md` steals `[[note]]` from `a/note.md`,
 *      and those links have to be qualified to keep meaning what they meant.
 *      Only the renamed path changes, so a link whose resolution moves must
 *      land on `to` — which makes the post-rename resolver the exact test.
 *      Alias entries ride along, so a link resolving only through an alias
 *      the new name captures is named too.
 */
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
