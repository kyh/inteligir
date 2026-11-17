// Obsidian-style resolution: a real filename always beats an alias, and every
// tier breaks ambiguity the same way (fewest segments, shortest, lexicographic)
// so the answer is independent of insertion order. Md urls are literal paths:
// file-relative, then root-relative, no alias tiers.

import { IMPLIED_LINK_EXTENSION, wikiLinkName } from "@repo/contract/knowledge/doc-file";
import {
  basenamePath,
  dirnamePath,
  extnamePath,
  joinPath,
  normalizePath,
} from "@repo/contract/knowledge/folder-path";

export interface TargetResolver {
  resolveWiki: (target: string) => string | null;
  resolveMd: (target: string, fromPath: string) => string | null;
}

const pickBest = (candidates: Iterable<string>): string | null => {
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

// the keys the name tier files a path under: its basename, and that without the extension a link
// may leave off. a bare name (no `/`) answers to exactly the paths filed under it, case aside: the
// exact tiers reach only root files, which are filed there too
export const wikiNameKeys = (path: string): readonly string[] => {
  const base = basenamePath(path);
  const name = wikiLinkName(path);
  return name === base ? [base] : [base, name];
};

const add = (map: Map<string, Set<string>>, key: string, path: string): void => {
  const owners = map.get(key);
  if (owners) {
    owners.add(path);
  } else {
    map.set(key, new Set([path]));
  }
};

const ownersOf = (map: Map<string, Set<string>>, key: string): Iterable<string> =>
  map.get(key) ?? [];

// alias keys are normalized like written targets so an alias containing `/` matches the same clean form
const filedResolver = (): TargetResolver & {
  addPath: (path: string) => void;
  addAlias: (path: string, alias: string) => void;
} => {
  const exact = new Set<string>();
  const exactLower = new Map<string, Set<string>>();
  const byName = new Map<string, Set<string>>();
  const byNameLower = new Map<string, Set<string>>();
  const aliasCs = new Map<string, Set<string>>();
  const aliasCi = new Map<string, Set<string>>();

  const addPath = (raw: string): void => {
    const path = normalizePath(raw);
    if (path === "" || exact.has(path)) {
      return;
    }
    exact.add(path);
    add(exactLower, path.toLowerCase(), path);
    for (const key of wikiNameKeys(path)) {
      add(byName, key, path);
      add(byNameLower, key.toLowerCase(), path);
    }
  };

  const addAlias = (raw: string, alias: string): void => {
    const owner = normalizePath(raw);
    const key = normalizePath(alias.trim());
    if (owner === "" || key === "") {
      return;
    }
    add(aliasCs, key, owner);
    add(aliasCi, key.toLowerCase(), owner);
  };

  const lookupExact = (candidate: string): string | null => {
    if (exact.has(candidate)) {
      return candidate;
    }
    return pickBest(ownersOf(exactLower, candidate.toLowerCase()));
  };

  // the basename tier: exact spelling first, then case-insensitively
  const lookupByName = (clean: string): string | null => {
    if (clean.includes("/")) {
      // every path ending in `/${clean}` or `/${clean}.md` is keyed in byName under
      // basenamePath(clean), so that bucket holds every suffix candidate
      const suffixes = [`/${clean}`, `/${clean}${IMPLIED_LINK_EXTENSION}`];
      const key = basenamePath(clean);
      const cs = pickBest(
        [...ownersOf(byName, key)].filter((p) => suffixes.some((s) => p.endsWith(s))),
      );
      if (cs !== null) {
        return cs;
      }
      const lowerSuffixes = suffixes.map((s) => s.toLowerCase());
      return pickBest(
        [...ownersOf(byNameLower, key.toLowerCase())].filter((p) =>
          lowerSuffixes.some((s) => p.toLowerCase().endsWith(s)),
        ),
      );
    }
    const cs = pickBest(ownersOf(byName, clean));
    if (cs !== null) {
      return cs;
    }
    return pickBest(ownersOf(byNameLower, clean.toLowerCase()));
  };

  const resolveWiki = (target: string): string | null => {
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
    const aliasHit = pickBest(ownersOf(aliasCs, clean));
    if (aliasHit !== null) {
      return aliasHit;
    }
    return pickBest(ownersOf(aliasCi, clean.toLowerCase()));
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

  return { addAlias, addPath, resolveMd, resolveWiki };
};

export const buildResolver = (
  paths: Iterable<string>,
  aliasEntries?: Iterable<readonly [alias: string, path: string]>,
): TargetResolver => {
  const filed = filedResolver();
  for (const path of paths) {
    filed.addPath(path);
  }
  for (const [alias, owner] of aliasEntries ?? []) {
    filed.addAlias(owner, alias);
  }
  const { resolveMd, resolveWiki } = filed;
  return { resolveMd, resolveWiki };
};
