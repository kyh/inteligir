// ---------------------------------------------------------------------------
// Obsidian-style link-target resolution over a vault file listing.
//
// Wiki targets resolve root-relative through five tiers, path tiers each
// case-sensitive first with a case-insensitive fallback:
//   1. exact path   — `dir/note` / `dir/note.md`
//   2. basename     — `note` matches any `**/note.md` (extension-less targets
//                     imply `.md`; other extensions must be written out)
//   3. path suffix  — `sub/note` matches any `**/sub/note.md`
//   4. alias (cs)   — frontmatter `aliases:` entries, case-sensitive
//   5. alias (ci)   — same, case-insensitive
// A real filename ALWAYS beats an alias (Obsidian: "note name wins over
// alias") — the alias tiers run only after every path tier missed, from both
// the slashless and slashed branches (an alias may contain `/`).
// Ambiguity is broken deterministically in every tier: fewest path segments,
// then shortest string, then lexicographic — the "closest to the root" file
// wins, independent of insertion/rebuild order.
//
// Md urls resolve file-relative (from the linking doc's directory) with a
// vault-root-relative fallback; extension-less urls also try `.md`. Aliases
// are wiki-only — md urls are literal paths.
// ---------------------------------------------------------------------------

import { basenamePath, dirnamePath, extnamePath, joinPath, normalizePath } from "./vault-path";

export type TargetResolver = {
  /** Resolve a wiki target (`[[target]]`) to a vault path, or null. */
  resolveWiki: (target: string) => string | null;
  /** Resolve an md url path (decoded, fragment-stripped) from `fromPath`. */
  resolveMd: (target: string, fromPath: string) => string | null;
};

/** The deterministic ambiguity break every tier shares (fewest segments,
 * shortest, lexicographic) — exported so the id tier in link-graph-index
 * breaks a duplicated frontmatter id the same way. */
export function pickBest(candidates: readonly string[]): string | null {
  if (candidates.length === 0) return null;
  let best: string | null = null;
  let bestSegments = Number.POSITIVE_INFINITY;
  for (const path of candidates) {
    const segments = path.split("/").length;
    if (
      best === null ||
      segments < bestSegments ||
      (segments === bestSegments &&
        (path.length < best.length || (path.length === best.length && path < best)))
    ) {
      best = path;
      bestSegments = segments;
    }
  }
  return best;
}

function push(map: Map<string, string[]>, key: string, path: string): void {
  const list = map.get(key);
  if (list) list.push(path);
  else map.set(key, [path]);
}

/** Build a resolver over the vault's file paths (docs AND other files — a
 * `[[diagram.png]]` embed resolves too). `aliasEntries` — (alias, owner path)
 * pairs from the docs' frontmatter `aliases:` — feed the two below-path
 * tiers; alias keys are normalized like written targets so an alias
 * containing `/` matches the same clean form. */
export function buildResolver(
  paths: Iterable<string>,
  aliasEntries?: Iterable<readonly [alias: string, path: string]>,
): TargetResolver {
  const exact = new Set<string>();
  const exactLower = new Map<string, string[]>();
  const byName = new Map<string, string[]>();
  const byNameLower = new Map<string, string[]>();
  const aliasCs = new Map<string, string[]>();
  const aliasCi = new Map<string, string[]>();

  for (const raw of paths) {
    const path = normalizePath(raw);
    if (path === "" || exact.has(path)) continue;
    exact.add(path);
    push(exactLower, path.toLowerCase(), path);
    const base = basenamePath(path);
    push(byName, base, path);
    push(byNameLower, base.toLowerCase(), path);
    if (extnamePath(base).toLowerCase() === ".md") {
      const stem = base.slice(0, -3);
      push(byName, stem, path);
      push(byNameLower, stem.toLowerCase(), path);
    }
  }

  if (aliasEntries) {
    for (const [alias, rawOwner] of aliasEntries) {
      const key = normalizePath(alias.trim());
      const owner = normalizePath(rawOwner);
      if (key === "" || owner === "") continue;
      push(aliasCs, key, owner);
      push(aliasCi, key.toLowerCase(), owner);
    }
  }

  /** cs → ci lookup of one exact path candidate. */
  const lookupExact = (candidate: string): string | null => {
    if (exact.has(candidate)) return candidate;
    return pickBest(exactLower.get(candidate.toLowerCase()) ?? []);
  };

  const resolveWiki = (target: string): string | null => {
    const clean = normalizePath(target);
    if (clean === "" || clean.startsWith("..")) return null;

    // Tier 1 — exact path (as written, then with `.md` implied).
    for (const candidate of [clean, `${clean}.md`]) {
      const hit = lookupExact(candidate);
      if (hit !== null) return hit;
    }

    if (!clean.includes("/")) {
      // Tier 2 — basename / stem.
      const cs = pickBest(byName.get(clean) ?? []);
      if (cs !== null) return cs;
      const ci = pickBest(byNameLower.get(clean.toLowerCase()) ?? []);
      if (ci !== null) return ci;
    } else {
      // Tier 3 — path suffix. Any path ending in `/${clean}` has basename
      // `basenamePath(clean)`; any path ending in `/${clean}.md` has basename
      // `basenamePath(clean) + ".md"`, whose `.md` stem is `basenamePath(clean)`.
      // Both are keyed in `byName`/`byNameLower` under `basenamePath(clean)`, so
      // that bucket provably contains every Tier-3 candidate — filter it with the
      // SAME suffix checks instead of scanning the whole listing.
      const suffixes = [`/${clean}`, `/${clean}.md`];
      const key = basenamePath(clean);
      const cs = pickBest(
        (byName.get(key) ?? []).filter((p) => suffixes.some((s) => p.endsWith(s))),
      );
      if (cs !== null) return cs;
      const lowerSuffixes = suffixes.map((s) => s.toLowerCase());
      const ci = pickBest(
        (byNameLower.get(key.toLowerCase()) ?? []).filter((p) =>
          lowerSuffixes.some((s) => p.toLowerCase().endsWith(s)),
        ),
      );
      if (ci !== null) return ci;
    }

    // Tiers 4/5 — alias, case-sensitive then case-insensitive. Reached from
    // BOTH branches above (neither returns on a miss): a real
    // filename always beats an alias, and an alias may contain `/`.
    const aliasHit = pickBest(aliasCs.get(clean) ?? []);
    if (aliasHit !== null) return aliasHit;
    return pickBest(aliasCi.get(clean.toLowerCase()) ?? []);
  };

  const resolveMd = (target: string, fromPath: string): string | null => {
    const candidates: string[] = [];
    const fromDir = dirnamePath(normalizePath(fromPath));
    const relative = joinPath(fromDir, target);
    if (relative !== "" && !relative.startsWith("..")) candidates.push(relative);
    const rooted = normalizePath(target);
    if (rooted !== "" && !rooted.startsWith("..") && rooted !== relative) candidates.push(rooted);
    for (const candidate of candidates) {
      const tryPaths = extnamePath(candidate) === "" ? [candidate, `${candidate}.md`] : [candidate];
      for (const path of tryPaths) {
        const hit = lookupExact(path);
        if (hit !== null) return hit;
      }
    }
    return null;
  };

  return { resolveWiki, resolveMd };
}
