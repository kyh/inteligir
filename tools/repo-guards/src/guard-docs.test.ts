// what the docs say of the guards is how a reader trusts one that stays silent, and the
// dangling-reference sweep reads paths, not names: a guard the list leaves out, or a table no source
// holds, is a promise nothing keeps.

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT, sourceOf, trackedFiles } from "./repo";

const GUARD_DIR = "tools/repo-guards/src/";
const README = "tools/repo-guards/README.md";
const DOCS = [README, "tools/repo-guards/CLAUDE.md", "packages/contract/README.md"];
const ANCHOR_GUARD = "dep-dag.test.ts";
const ANCHOR_TABLE = "DECLARED_EDGES";

const LISTED_GUARD = /^- `(?<guard>[a-z0-9-]+\.test\.ts)`:/gmu;
const CITED_NAME = /`(?<name>[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*)`/gu;
const SOURCE_NAME = /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*\b/gu;
const SOURCE_FILE = /\.tsx?$/u;

const readDoc = (file: string): string => fs.readFileSync(path.join(REPO_ROOT, file), "utf-8");

const captured = (text: string, pattern: RegExp, group: string): string[] =>
  [...text.matchAll(pattern)].flatMap((match) => match.groups?.[group] ?? []);

const guardsOnDisk = (): string[] =>
  trackedFiles()
    .filter((file) => file.startsWith(GUARD_DIR) && file.endsWith(".test.ts"))
    .map((file) => file.slice(GUARD_DIR.length));

// sourceOf drops full-line comments, so a comment cannot keep a dead name alive
const namesInSource = (): Set<string> =>
  new Set(
    trackedFiles()
      .filter((file) => SOURCE_FILE.test(file))
      .flatMap((file) => sourceOf(file).match(SOURCE_NAME) ?? []),
  );

describe("the guards' docs", () => {
  it("lists every guard in the README, and no guard that is gone", () => {
    const onDisk = guardsOnDisk();
    if (!onDisk.includes(ANCHOR_GUARD)) {
      throw new Error(`${GUARD_DIR} holds no ${ANCHOR_GUARD} — the sweep is broken, not the tree`);
    }
    const listed = captured(readDoc(README), LISTED_GUARD, "guard");
    expect(
      {
        gone: listed.filter((guard) => !onDisk.includes(guard)),
        unlisted: onDisk.filter((guard) => !listed.includes(guard)),
      },
      `${README} § The guards and ${GUARD_DIR} disagree.\n` +
        `  rule: the list is one row per guard, so a reader can tell what is checked from what is not\n` +
        `  fix: add a row for an unlisted guard, and delete the row of one that is gone\n`,
    ).toStrictEqual({ gone: [], unlisted: [] });
  });

  it("cites only names the source holds", () => {
    const cited = DOCS.flatMap((doc) =>
      captured(readDoc(doc), CITED_NAME, "name").map((name) => ({ doc, name })),
    );
    if (!cited.some(({ name }) => name === ANCHOR_TABLE)) {
      throw new Error(`no doc cites ${ANCHOR_TABLE} — the sweep is broken, not the tree`);
    }
    const held = namesInSource();
    const dead = cited
      .filter(({ name }) => !held.has(name))
      .map(({ doc, name }) => `  ${doc}  ${name}`);
    expect(
      dead,
      `These docs cite a name no source holds.\n` +
        `  rule: a table or constant named beside a guard is one a reader can open\n` +
        `  fix: repoint the citation at the live name, or delete it with what it named\n` +
        `${dead.join("\n")}\n`,
    ).toStrictEqual([]);
  });
});
