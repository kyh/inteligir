import { describe, expect, it } from "vitest";

import { buildResolver } from "../knowledge/link-resolve";
import { basenamePath, extnamePath, normalizePath } from "../knowledge/vault-path";

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rand: () => number, items: readonly T[]): T {
  const item = items[Math.floor(rand() * items.length)];
  if (item === undefined) throw new Error("pick from empty list");
  return item;
}

// must match link-resolve's pickBest
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

// mirrors how buildResolver keys byName
function nameMatches(p: string, name: string): boolean {
  const base = basenamePath(p);
  if (base === name) return true;
  return extnamePath(base).toLowerCase() === ".md" && base.slice(0, -3) === name;
}

function oracleResolveWiki(all: readonly string[], target: string): string | null {
  const clean = normalizePath(target);
  if (clean === "" || clean.startsWith("..")) return null;

  for (const candidate of [clean, `${clean}.md`]) {
    if (all.includes(candidate)) return candidate;
    const lower = candidate.toLowerCase();
    const ci = pickBest(all.filter((p) => p.toLowerCase() === lower));
    if (ci !== null) return ci;
  }

  if (!clean.includes("/")) {
    const cs = pickBest(all.filter((p) => nameMatches(p, clean)));
    if (cs !== null) return cs;
    const lower = clean.toLowerCase();
    return pickBest(all.filter((p) => nameMatches(p.toLowerCase(), lower)));
  }

  const suffixes = [`/${clean}`, `/${clean}.md`];
  const cs = pickBest(all.filter((p) => suffixes.some((s) => p.endsWith(s))));
  if (cs !== null) return cs;
  const lowerSuffixes = suffixes.map((s) => s.toLowerCase());
  return pickBest(all.filter((p) => lowerSuffixes.some((s) => p.toLowerCase().endsWith(s))));
}

function buildSyntheticVault(rand: () => number, count: number): string[] {
  const dirs = ["", "notes", "wiki", "projects/alpha", "projects/beta", "Deep/Nested/Dir", "sub"];
  const stems = ["note", "Note", "roadmap", "digest", "Plan", "tasks", "readme", "Ideas"];
  const exts = [".md", ".md", ".md", ".png", ".txt"];
  const seen = new Set<string>();
  const paths: string[] = [];
  while (paths.length < count) {
    const dir = pick(rand, dirs);
    const stem = `${pick(rand, stems)}${Math.floor(rand() * 400)}`;
    const ext = pick(rand, exts);
    const path = dir === "" ? `${stem}${ext}` : `${dir}/${stem}${ext}`;
    if (seen.has(path)) continue;
    seen.add(path);
    paths.push(path);
  }
  return paths;
}

function caseMangle(rand: () => number, s: string): string {
  if (rand() < 0.5) return s.toLowerCase();
  if (rand() < 0.5) return s.toUpperCase();
  return s;
}

describe("link-resolve — bucket Tier 3 equals the full-scan oracle", () => {
  // ~5s under a contended full-repo run; the default 5s timeout is too tight
  it("matches on 1,000 path-style targets over 5,000 synthetic paths", { timeout: 20_000 }, () => {
    const rand = mulberry32(0xc0ffee);
    const paths = buildSyntheticVault(rand, 5000);
    const resolver = buildResolver(paths);

    for (let i = 0; i < 1000; i++) {
      const source = pick(rand, paths);
      const segments = source.split("/");
      const take = Math.min(segments.length, 1 + Math.floor(rand() * 3));
      let target = segments.slice(segments.length - take).join("/");
      if (target.endsWith(".md") && rand() < 0.5) target = target.slice(0, -3);
      if (rand() < 0.4) target = caseMangle(rand, target);
      if (rand() < 0.1) target = `missing-dir/${target}`;

      expect(resolver.resolveWiki(target), `target: ${JSON.stringify(target)}`).toBe(
        oracleResolveWiki(paths, target),
      );
    }
  });

  it("matches on handcrafted Tier-3 edge shapes", () => {
    const paths = [
      "a/sub/note.md",
      "b/sub/note.md",
      "c/deep/sub/note.md",
      "x/Sub/Note.md",
      "y/sub/note.png",
      "z/sub/note.md.md",
      "sub/note.md",
    ];
    const resolver = buildResolver(paths);
    const targets = [
      "sub/note",
      "sub/note.md",
      "Sub/Note",
      "SUB/NOTE.MD",
      "sub/note.png",
      "sub/note.md.md",
      "deep/sub/note",
      "nope/note",
      "sub/missing",
    ];
    for (const target of targets) {
      expect(resolver.resolveWiki(target), `target: ${JSON.stringify(target)}`).toBe(
        oracleResolveWiki(paths, target),
      );
    }
  });
});
