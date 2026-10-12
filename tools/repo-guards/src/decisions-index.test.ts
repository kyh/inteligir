// Each workspace's decisions live in a CLAUDE.md beside its code, which a session loads only on
// opening that directory, so AGENTS.md § Decisions is how an agent elsewhere finds one. The root is
// loaded into every session: a group pasted back into it costs every session its tokens again.

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT, trackedFiles } from "./repo";

const ROOT_GUIDE = "AGENTS.md";
const ROOT_CLAUDE_MD = "CLAUDE.md";
const SECTION_HEADING = "## Decisions";
const INDEX_ENTRY = /^- \[`(?<file>[^`]+)`\]\(\k<file>\)/u;
const DECISION_GROUP = /^(?:### |- \*\*)/u;

const readRepoFile = (file: string): string => fs.readFileSync(path.join(REPO_ROOT, file), "utf-8");

const decisionsSection = (): string[] => {
  const lines = readRepoFile(ROOT_GUIDE).split("\n");
  const start = lines.indexOf(SECTION_HEADING);
  if (start === -1) {
    throw new Error(
      `${ROOT_GUIDE} has no "${SECTION_HEADING}" — the sweep is broken, not the tree`,
    );
  }
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith("## "));
  return end === -1 ? rest : rest.slice(0, end);
};

const indexedFiles = (): string[] =>
  decisionsSection().flatMap((line) => {
    const file = INDEX_ENTRY.exec(line)?.groups?.file;
    return file === undefined ? [] : [file];
  });

const decisionFiles = (): string[] =>
  trackedFiles().filter(
    (file) => path.posix.basename(file) === ROOT_CLAUDE_MD && file !== ROOT_CLAUDE_MD,
  );

describe(`${ROOT_GUIDE} § Decisions`, () => {
  it("indexes every decision file, and only files that exist", () => {
    const indexed = indexedFiles();
    const tracked = decisionFiles();
    expect(indexed.length, `${ROOT_GUIDE} § Decisions indexes no file`).toBeGreaterThan(0);
    expect(
      { gone: indexed.filter((file) => !tracked.includes(file)) },
      `${ROOT_GUIDE} § Decisions indexes a file that is not tracked.\n` +
        `  fix: repoint the entry at the file's path, or delete it with the file`,
    ).toEqual({ gone: [] });
    expect(
      { unindexed: tracked.filter((file) => !indexed.includes(file)) },
      `a CLAUDE.md below the root has no line in ${ROOT_GUIDE} § Decisions, so an agent that never opened its directory cannot find it.\n` +
        '  fix: add "- [`<dir>/CLAUDE.md`](<dir>/CLAUDE.md) — <what it governs>" to the index',
    ).toEqual({ unindexed: [] });
  });

  it("leaves no decision in the root", () => {
    expect(
      readRepoFile(ROOT_CLAUDE_MD),
      `the root ${ROOT_CLAUDE_MD} is the one import of ${ROOT_GUIDE}.\n` +
        `  fix: move what was added to ${ROOT_GUIDE}, or to the CLAUDE.md beside the code it governs`,
    ).toBe(`@${ROOT_GUIDE}\n`);
    expect(
      decisionsSection().filter((line) => DECISION_GROUP.test(line)),
      `${ROOT_GUIDE} § Decisions holds a group or a bullet of its own.\n` +
        `  fix: move it to the CLAUDE.md beside the code it governs`,
    ).toEqual([]);
  });
});
