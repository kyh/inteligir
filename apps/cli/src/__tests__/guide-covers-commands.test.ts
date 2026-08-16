// The doc-sync discipline with teeth (bb keeps it as prose in
// docs/cli-guide-and-skill.md; here it is a fitness test): the SKILL.md the
// app serves must name every CLI leaf command, so adding or renaming a
// command forces the manual to move in the same change. Read as FILE BYTES —
// the CLI must not import the server's module, and the two workspaces ship in
// one checkout, so the path is a structural fact.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { collectLeafCommands, testProgram } from "./command-tree";

const CLI_SKILL_URL = new URL("../../../app/src/node/guide/cli-skill.ts", import.meta.url);

describe("the served guide covers the command surface", () => {
  it("names every leaf command", () => {
    const skillSource = readFileSync(CLI_SKILL_URL, "utf8");
    const commands = collectLeafCommands(testProgram());
    expect(commands.length).toBeGreaterThan(0);

    const unmentioned = commands
      .map(({ path }) => `inteligir ${path}`)
      .filter((invocation) => !skillSource.includes(invocation));
    expect(unmentioned).toEqual([]);
  });
});
