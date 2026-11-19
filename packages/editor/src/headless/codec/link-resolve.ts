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

const pickBest = (candidates: Iterable<string>) => {
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

export const wikiNameKeys = (path: string) => {
  const base = basenamePath(path);
  const name = wikiLinkName(path);

  return (name === base ? [base] : [base, name]) satisfies readonly string[];
};

const add = (map: Map<string, Set<string>>, key: string, path: string) => {
  const owners = map.get(key);

  if (owners) {
    owners.add(path);
  } else {
    map.set(key, new Set([path]));
  }
};

const ownersOf = (map: Map<string, Set<string>>, key: string) =>
  (map.get(key) ?? []) satisfies Iterable<string>;

const filedResolver = () => {
  const exact = new Set<string>();
  const exactLower = new Map<string, Set<string>>();
  const byName = new Map<string, Set<string>>();
  const byNameLower = new Map<string, Set<string>>();
  const aliasCs = new Map<string, Set<string>>();
  const aliasCi = new Map<string, Set<string>>();

  const addPath = (raw: string) => {
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

  const addAlias = (raw: string, alias: string) => {
    const owner = normalizePath(raw);
    const key = normalizePath(alias.trim());

    if (owner === "" || key === "") {
      return;
    }

    add(aliasCs, key, owner);
    add(aliasCi, key.toLowerCase(), owner);
  };

  const lookupExact = (candidate: string) => {
    if (exact.has(candidate)) {
      return candidate;
    }

    return pickBest(ownersOf(exactLower, candidate.toLowerCase()));
  };

  const lookupByName = (clean: string) => {
    if (clean.includes("/")) {
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

  const resolveWiki = (target: string) => {
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

    const aliasHit = pickBest(ownersOf(aliasCs, clean));

    if (aliasHit !== null) {
      return aliasHit;
    }

    return pickBest(ownersOf(aliasCi, clean.toLowerCase()));
  };

  const resolveMd = (target: string, fromPath: string) => {
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

  return { addAlias, addPath, resolveMd, resolveWiki } satisfies TargetResolver & {
    addPath: (path: string) => void;
    addAlias: (path: string, alias: string) => void;
  };
};

export const buildResolver = (
  paths: Iterable<string>,
  aliasEntries?: Iterable<readonly [alias: string, path: string]>,
) => {
  const filed = filedResolver();

  for (const path of paths) {
    filed.addPath(path);
  }

  for (const [alias, owner] of aliasEntries ?? []) {
    filed.addAlias(owner, alias);
  }

  const { resolveMd, resolveWiki } = filed;

  return { resolveMd, resolveWiki } satisfies TargetResolver;
};
