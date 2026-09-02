// Obsidian-style resolution: a real filename always beats an alias, and every
// tier breaks ambiguity the same way (fewest segments, shortest, lexicographic)
// so the answer is independent of insertion order. Md urls are literal paths:
// file-relative, then root-relative, no alias tiers.

import { isUuidWikiAlias } from "../markdown/remark-wiki-link";
import { basenamePath, dirnamePath, extnamePath, joinPath, normalizePath } from "./vault-path";

export type TargetResolver = {
  resolveWiki: (target: string, alias?: string) => string | null;
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

// alias keys are normalized like written targets so an alias containing `/` matches the same clean form
export function buildResolver(
  paths: Iterable<string>,
  aliasEntries?: Iterable<readonly [alias: string, path: string]>,
  idEntries?: Iterable<readonly [id: string, path: string]>,
): TargetResolver {
  const exact = new Set<string>();
  const exactLower = new Map<string, string[]>();
  const byName = new Map<string, string[]>();
  const byNameLower = new Map<string, string[]>();
  const aliasCs = new Map<string, string[]>();
  const aliasCi = new Map<string, string[]>();
  const idOwners = new Map<string, string[]>();

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

  if (idEntries) {
    for (const [id, rawOwner] of idEntries) {
      const owner = normalizePath(rawOwner);
      if (id === "" || owner === "") continue;
      push(idOwners, id, owner);
    }
  }

  const lookupExact = (candidate: string): string | null => {
    if (exact.has(candidate)) return candidate;
    return pickBest(exactLower.get(candidate.toLowerCase()) ?? []);
  };

  const resolveWiki = (target: string, alias?: string): string | null => {
    // a uuid-shaped alias names the target by frontmatter id; a display alias never does
    if (alias !== undefined && isUuidWikiAlias(alias)) {
      const owned = pickBest(idOwners.get(alias) ?? []);
      if (owned !== null) return owned;
    }
    const clean = normalizePath(target);
    if (clean === "" || clean.startsWith("..")) return null;

    for (const candidate of [clean, `${clean}.md`]) {
      const hit = lookupExact(candidate);
      if (hit !== null) return hit;
    }

    if (!clean.includes("/")) {
      const cs = pickBest(byName.get(clean) ?? []);
      if (cs !== null) return cs;
      const ci = pickBest(byNameLower.get(clean.toLowerCase()) ?? []);
      if (ci !== null) return ci;
    } else {
      // every path ending in `/${clean}` or `/${clean}.md` is keyed in byName under
      // basenamePath(clean), so that bucket holds every suffix candidate
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

    // reached from both branches above: a real filename always beats an alias, and an alias may contain `/`
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
