import { describe, expect, it } from "vitest";

import { buildResolver, createPathResolver } from "../knowledge/link-resolve";
import type { TargetResolver } from "../knowledge/link-resolve";
import { mulberry32, pick } from "./seeded-random";

const DIRS = ["", "a/", "a/b/", "B/", "notes/"];
const NAMES = ["note", "Note", "todo", "img.png", "x.md", "Note.md", "note.txt", "deep"];
const ALIASES = ["alias", "Alias", "a/alias", "note", "Todo", "  spaced  "];
const IDS = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"];

const randomPath = (rand: () => number): string => {
  const name = pick(rand, NAMES);
  return `${pick(rand, DIRS)}${name.includes(".") ? name : `${name}.md`}`;
};

const PROBES = [
  "note",
  "Note",
  "NOTE",
  "todo",
  "img.png",
  "a/note",
  "b/note",
  "a/b/note",
  "alias",
  "ALIAS",
  "a/alias",
  "spaced",
  "x",
  "x.md",
  "note.txt",
  "deep",
  "B/Note",
];

const answers = (resolver: TargetResolver): unknown[] => [
  ...PROBES.map((probe) => resolver.resolveWiki(probe)),
  ...PROBES.map((probe) => resolver.resolveMd(probe, "a/b/from.md")),
  ...IDS.map((id) => resolver.resolveNoteId(id)),
  ...IDS.map((id) => resolver.resolveWiki("anything", id)),
];

describe("the incremental resolver", () => {
  it("answers as a resolver built from scratch over the final sets, after any sequence", () => {
    const rand = mulberry32(0x1e_50_1e);
    for (let run = 0; run < 300; run += 1) {
      const live = createPathResolver();
      const paths = new Set<string>();
      const aliases = new Map<string, string[]>();
      const ids = new Map<string, string>();
      for (let step = 0; step < 40; step += 1) {
        const path = randomPath(rand);
        const roll = rand();
        if (roll < 0.4) {
          live.addPath(path);
          paths.add(path);
        } else if (roll < 0.6) {
          live.removePath(path);
          paths.delete(path);
          live.setAliases(path, []);
          aliases.delete(path);
          live.setNoteId(path, null);
          ids.delete(path);
        } else if (roll < 0.8) {
          const next = Array.from({ length: Math.floor(rand() * 3) }, () => pick(rand, ALIASES));
          live.setAliases(path, next);
          aliases.set(path, next);
        } else {
          const id = rand() < 0.3 ? null : pick(rand, IDS);
          live.setNoteId(path, id);
          if (id === null) {
            ids.delete(path);
          } else {
            ids.set(path, id);
          }
        }
      }
      const rebuilt = buildResolver(
        paths,
        [...aliases].flatMap(([path, list]) => list.map((alias) => [alias, path] as const)),
        [...ids].map(([path, id]) => [id, path] as const),
      );
      expect(answers(live), `run ${String(run)}`).toEqual(answers(rebuilt));
    }
  });
});
