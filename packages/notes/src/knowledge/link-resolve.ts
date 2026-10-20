// Obsidian-style resolution: a real filename always beats an alias, and every
// tier breaks ambiguity the same way (fewest segments, shortest, lexicographic)
// so the answer is independent of insertion order. Md urls are literal paths:
// file-relative, then root-relative, no alias tiers.

import { isUuidWikiAlias, serializeWikiBody } from "../markdown/remark-wiki-link";
import { IMPLIED_LINK_EXTENSION, wikiLinkName, wikiLinkPath } from "./doc-file";
import { basenamePath, dirnamePath, extnamePath, joinPath, normalizePath } from "./vault-path";

export interface TargetResolver {
  resolveWiki: (target: string, alias?: string) => string | null;
  resolveMd: (target: string, fromPath: string) => string | null;
  // the doc whose frontmatter `id` this is; a copied file carries its original's, so it breaks
  // like every other tier
  resolveNoteId: (id: string) => string | null;
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

const drop = (map: Map<string, Set<string>>, key: string, path: string): void => {
  const owners = map.get(key);
  if (owners === undefined) {
    return;
  }
  owners.delete(path);
  if (owners.size === 0) {
    map.delete(key);
  }
};

const ownersOf = (map: Map<string, Set<string>>, key: string): Iterable<string> =>
  map.get(key) ?? [];

// a resolver kept live as the vault moves: each path, alias and id is filed and unfiled on its
// own, so a new note costs its own keys rather than a rebuild over every path (the index asks
// this once per save). every answer is the one `buildResolver` gives over the same final sets.
export type PathResolver = TargetResolver & {
  addPath: (path: string) => void;
  removePath: (path: string) => void;
  // replaces every alias the path owned
  setAliases: (path: string, aliases: readonly string[]) => void;
  setNoteId: (path: string, id: string | null) => void;
};

// alias keys are normalized like written targets so an alias containing `/` matches the same clean form
interface FilingResolver {
  resolver: PathResolver;
  setNoteIds: (path: string, ids: readonly string[]) => void;
}

const filingResolver = (): FilingResolver => {
  const exact = new Set<string>();
  const exactLower = new Map<string, Set<string>>();
  const byName = new Map<string, Set<string>>();
  const byNameLower = new Map<string, Set<string>>();
  const aliasCs = new Map<string, Set<string>>();
  const aliasCi = new Map<string, Set<string>>();
  const aliasKeysOf = new Map<string, readonly string[]>();
  const idOwners = new Map<string, Set<string>>();
  const idsOf = new Map<string, readonly string[]>();

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

  const removePath = (raw: string): void => {
    const path = normalizePath(raw);
    if (!exact.delete(path)) {
      return;
    }
    drop(exactLower, path.toLowerCase(), path);
    for (const key of wikiNameKeys(path)) {
      drop(byName, key, path);
      drop(byNameLower, key.toLowerCase(), path);
    }
  };

  const setAliases = (raw: string, aliases: readonly string[]): void => {
    const owner = normalizePath(raw);
    if (owner === "") {
      return;
    }
    for (const key of aliasKeysOf.get(owner) ?? []) {
      drop(aliasCs, key, owner);
      drop(aliasCi, key.toLowerCase(), owner);
    }
    const keys = aliases.map((alias) => normalizePath(alias.trim())).filter((key) => key !== "");
    for (const key of keys) {
      add(aliasCs, key, owner);
      add(aliasCi, key.toLowerCase(), owner);
    }
    if (keys.length === 0) {
      aliasKeysOf.delete(owner);
    } else {
      aliasKeysOf.set(owner, keys);
    }
  };

  // a copy carries its original's id, and an owner listed under two ids answers to both
  const setNoteIds = (raw: string, ids: readonly string[]): void => {
    const owner = normalizePath(raw);
    if (owner === "") {
      return;
    }
    for (const prior of idsOf.get(owner) ?? []) {
      drop(idOwners, prior, owner);
    }
    const kept = ids.filter((id) => id !== "");
    for (const id of kept) {
      add(idOwners, id, owner);
    }
    if (kept.length === 0) {
      idsOf.delete(owner);
    } else {
      idsOf.set(owner, kept);
    }
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

  const resolveNoteId = (id: string): string | null => pickBest(ownersOf(idOwners, id));

  const resolveWiki = (target: string, alias?: string): string | null => {
    // a uuid-shaped alias names the target by frontmatter id; a display alias never does
    if (alias !== undefined && isUuidWikiAlias(alias)) {
      const owned = resolveNoteId(alias);
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

  const setNoteId = (path: string, id: string | null): void => {
    setNoteIds(path, id === null ? [] : [id]);
  };

  return {
    resolver: { addPath, removePath, resolveMd, resolveNoteId, resolveWiki, setAliases, setNoteId },
    setNoteIds,
  };
};

export const createPathResolver = (): PathResolver => filingResolver().resolver;

// one alias list and one id per owner, as a doc carries them
const groupByOwner = <T>(
  entries: Iterable<readonly [value: T, owner: string]>,
): Map<string, T[]> => {
  const owned = new Map<string, T[]>();
  for (const [value, rawOwner] of entries) {
    const owner = normalizePath(rawOwner);
    const list = owned.get(owner);
    if (list) {
      list.push(value);
    } else {
      owned.set(owner, [value]);
    }
  }
  return owned;
};

export const buildResolver = (
  paths: Iterable<string>,
  aliasEntries?: Iterable<readonly [alias: string, path: string]>,
  idEntries?: Iterable<readonly [id: string, path: string]>,
): TargetResolver => {
  const { resolver, setNoteIds } = filingResolver();
  for (const path of paths) {
    resolver.addPath(path);
  }
  for (const [owner, aliases] of groupByOwner(aliasEntries ?? [])) {
    resolver.setAliases(owner, aliases);
  }
  for (const [owner, ids] of groupByOwner(idEntries ?? [])) {
    setNoteIds(owner, ids);
  }
  return resolver;
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

// the whole `[[…]]` for `path`, spelled as the `[[` picker writes it; null for a name no link can
// carry, so a caller writes nothing rather than a link that lands elsewhere
export const wikiLinkFor = (
  path: string,
  resolveWiki: (target: string) => string | null,
): string | null => {
  const body = serializeWikiBody({ target: wikiTargetForPath(path, resolveWiki) });
  return body === null ? null : `[[${body}]]`;
};
