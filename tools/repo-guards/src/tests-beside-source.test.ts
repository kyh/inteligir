// a module's suite is `<name>.test.ts` beside `<name>.ts`, and what a package's suites share is its
// test-support/ (tools/repo-guards/CLAUDE.md); a `__tests__` folder is a second place a reader
// must think to look for a module's tests, and one that drifts from the module it tests.

import { describe, expect, it } from "vitest";
import { trackedFiles } from "./repo";

const TESTS_FOLDER = /(?:^|\/)__tests__\//u;
const SUITE = /\.test\.[cm]?tsx?$/u;

describe("tests beside source", () => {
  it("no tracked path sits in a __tests__ folder", () => {
    const files = trackedFiles();
    if (!files.some((file) => SUITE.test(file))) {
      throw new Error("the tracked files hold no *.test.ts — the sweep is broken, not the tree");
    }
    const found = files.filter((file) => TESTS_FOLDER.test(file)).map((file) => `  ${file}`);
    expect(
      found,
      `These tracked paths sit in a __tests__ folder.\n` +
        `  rule: a test is <name>.test.ts beside the <name>.ts it tests, and a package's shared test code (harnesses, fakes, fixtures) is its test-support/ folder, so a module's tests are found in one place\n` +
        `  fix: git mv a suite to sit beside its module, a helper or fixture to the nearest test-support/, a snapshot to the __snapshots__/ beside its suite\n` +
        `${found.join("\n")}\n`,
    ).toEqual([]);
  });
});
