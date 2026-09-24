// Obsidian-style resolution: a real filename always beats an alias, and every
// tier breaks ambiguity the same way (fewest segments, shortest, lexicographic)
// so the answer is independent of insertion order. Md urls are literal paths:
// file-relative, then root-relative, no alias tiers.

import { isUuidWikiAlias } from "../markdown/remark-wiki-link";
import { IMPLIED_LINK_EXTENSION, wikiLinkName, wikiLinkPath } from "./doc-file";
import { basenamePath, dirnamePath, extnamePath, joinPath, normalizePath } from "./vault-path";

export interface TargetResolver {
  resolveWiki: (target: string, alias?: string) => string | null;
  resolveMd: (target: string, fromPath: string) => string | null;
}

const pickBest = (candidates: readonly string[]): string | null => {
  if (candidates.length === 0) {
    return null;
  }
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
};

const push = (map: Map<string, string[]>, key: string, path: string): void => {
  const list = map.get(key);
  if (list) {
    list.push(path);
  } else {
    map.set(key, [path]);
  }
};

// alias keys are normalized like written targets so an alias containing `/` matches the same clean form
export const buildResolver = (
  paths: Iterable<string>,
  aliasEntries?: Iterable<readonly [alias: string, path: string]>,
  idEntries?: Iterable<readonly [id: string, path: string]>,
): TargetResolver => {
  const exact = new Set<string>();
  const exactLower = new Map<string, string[]>();
  const byName = new Map<string, string[]>();
  const byNameLower = new Map<string, string[]>();
  const aliasCs = new Map<string, string[]>();
  const aliasCi = new Map<string, string[]>();
  const idOwners = new Map<string, string[]>();

  for (const raw of paths) {
    const path = normalizePath(raw);
    if (path === "" || exact.has(path)) {
      continue;
    }
    exact.add(path);
    push(exactLower, path.toLowerCase(), path);
    const base = basenamePath(path);
    push(byName, base, path);
    push(byNameLower, base.toLowerCase(), path);
    const name = wikiLinkName(path);
    if (name !== base) {
      push(byName, name, path);
      push(byNameLower, name.toLowerCase(), path);
    }
  }

  if (aliasEntries) {
    for (const [alias, rawOwner] of aliasEntries) {
      const key = normalizePath(alias.trim());
      const owner = normalizePath(rawOwner);
      if (key === "" || owner === "") {
        continue;
      }
      push(aliasCs, key, owner);
      push(aliasCi, key.toLowerCase(), owner);
    }
  }

  if (idEntries) {
    for (const [id, rawOwner] of idEntries) {
      const owner = normalizePath(rawOwner);
      if (id === "" || owner === "") {
        continue;
      }
      push(idOwners, id, owner);
    }
  }

  const lookupExact = (candidate: string): string | null => {
    if (exact.has(candidate)) {
      return candidate;
    }
    return pickBest(exactLower.get(candidate.toLowerCase()) ?? []);
  };

  // the basename tier: exact spelling first, then case-insensitively
  const lookupByName = (clean: string): string | null => {
    if (clean.includes("/")) {
      // every path ending in `/${clean}` or `/${clean}.md` is keyed in byName under
      // basenamePath(clean), so that bucket holds every suffix candidate
      const suffixes = [`/${clean}`, `/${clean}${IMPLIED_LINK_EXTENSION}`];
      const key = basenamePath(clean);
      const cs = pickBest(
        (byName.get(key) ?? []).filter((p) => suffixes.some((s) => p.endsWith(s))),
      );
      if (cs !== null) {
        return cs;
      }
      const lowerSuffixes = suffixes.map((s) => s.toLowerCase());
      return pickBest(
        (byNameLower.get(key.toLowerCase()) ?? []).filter((p) =>
          lowerSuffixes.some((s) => p.toLowerCase().endsWith(s)),
        ),
      );
    }
    const cs = pickBest(byName.get(clean) ?? []);
    if (cs !== null) {
      return cs;
    }
    return pickBest(byNameLower.get(clean.toLowerCase()) ?? []);
  };

  const resolveWiki = (target: string, alias?: string): string | null => {
    // a uuid-shaped alias names the target by frontmatter id; a display alias never does
    if (alias !== undefined && isUuidWikiAlias(alias)) {
      const owned = pickBest(idOwners.get(alias) ?? []);
      if (owned !== null) {
        return owned;
      }
    }
    const clean = normalizePath(target);
    if (clean === "" || clean.startsWith("..")) {
      return null;
    }

    for (const candidate of [clean, `${clean}${IMPLIED_LINK_EXTENSION}`]) {
      const hit = lookupExact(candidate);
      if (hit !== null) {
        return hit;
      }
    }

    const named = lookupByName(clean);
    if (named !== null) {
      return named;
    }

    // a real filename always beats an alias, and an alias may contain `/`
    const aliasHit = pickBest(aliasCs.get(clean) ?? []);
    if (aliasHit !== null) {
      return aliasHit;
    }
    return pickBest(aliasCi.get(clean.toLowerCase()) ?? []);
  };

  const resolveMd = (target: string, fromPath: string): string | null => {
    const candidates: string[] = [];
    const fromDir = dirnamePath(normalizePath(fromPath));
    const relative = joinPath(fromDir, target);
    if (relative !== "" && !relative.startsWith("..")) {
      candidates.push(relative);
    }
    const rooted = normalizePath(target);
    if (rooted !== "" && !rooted.startsWith("..") && rooted !== relative) {
      candidates.push(rooted);
    }
    for (const candidate of candidates) {
      const tryPaths =
        extnamePath(candidate) === ""
          ? [candidate, `${candidate}${IMPLIED_LINK_EXTENSION}`]
          : [candidate];
      for (const path of tryPaths) {
        const hit = lookupExact(path);
        if (hit !== null) {
          return hit;
        }
      }
    }
    return null;
  };

  return { resolveMd, resolveWiki };
};

// the shortest target that resolves back to `path`: its name, else its path, spelled without the
// extension a link may leave off, else the whole path, which an extensionless file of the same
// name would otherwise shadow. a path the resolver does not know yet gets the qualified spelling
export const wikiTargetForPath = (
  path: string,
  resolveWiki: (target: string) => string | null,
): string => {
  const qualified = wikiLinkPath(path);
  return (
    [wikiLinkName(path), qualified, path].find((target) => resolveWiki(target) === path) ??
    qualified
  );
};
