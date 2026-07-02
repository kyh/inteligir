// ---------------------------------------------------------------------------
// Obsidian-style link-target resolution over a vault file listing.
//
// Wiki targets resolve root-relative through three tiers, each case-sensitive
// first with a case-insensitive fallback:
//   1. exact path   — `dir/note` / `dir/note.md`
//   2. basename     — `note` matches any `**/note.md` (extension-less targets
//                     imply `.md`; other extensions must be written out)
//   3. path suffix  — `sub/note` matches any `**/sub/note.md`
// Ambiguity is broken deterministically: fewest path segments, then shortest
// string, then lexicographic — the "closest to the root" file wins.
//
// Md urls resolve file-relative (from the linking doc's directory) with a
// vault-root-relative fallback; extension-less urls also try `.md`.
// ---------------------------------------------------------------------------

import { basenamePath, dirnamePath, extnamePath, joinPath, normalizePath } from "./vault-path";

export type TargetResolver = {
  /** Resolve a wiki target (`[[target]]`) to a vault path, or null. */
  resolveWiki: (target: string) => string | null;
  /** Resolve an md url path (decoded, fragment-stripped) from `fromPath`. */
  resolveMd: (target: string, fromPath: string) => string | null;
};

function pickBest(candidates: readonly string[]): string | null {
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
 * `[[diagram.png]]` embed resolves too). */
export function buildResolver(paths: Iterable<string>): TargetResolver {
  const all: string[] = [];
  const exact = new Set<string>();
  const exactLower = new Map<string, string[]>();
  const byName = new Map<string, string[]>();
  const byNameLower = new Map<string, string[]>();

  for (const raw of paths) {
    const path = normalizePath(raw);
    if (path === "" || exact.has(path)) continue;
    all.push(path);
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
      return pickBest(byNameLower.get(clean.toLowerCase()) ?? []);
    }

    // Tier 3 — path suffix.
    const suffixes = [`/${clean}`, `/${clean}.md`];
    const cs = pickBest(all.filter((p) => suffixes.some((s) => p.endsWith(s))));
    if (cs !== null) return cs;
    const lowerSuffixes = suffixes.map((s) => s.toLowerCase());
    return pickBest(all.filter((p) => lowerSuffixes.some((s) => p.toLowerCase().endsWith(s))));
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
