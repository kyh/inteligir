// The doc-sync discipline with teeth (bb keeps it as prose in
// docs/cli-guide-and-skill.md): the SKILL.md the app serves must name every
// CLI leaf AND every flag those leaves accept, so adding, renaming or
// re-flagging a command forces the manual to move in the same change.
//
// Two things this deliberately does NOT do, because the first version did and
// they made it green while the guide was wrong: it does not read the module's
// SOURCE (a comment mentioning a command satisfied the check), and it does
// not stop at command names (`interactions answer --thread` was undocumented
// and unnoticed). It reads the guide's RENDERED markdown — the bytes an agent
// receives from GET /api/v1/guide — and the inventory comes from the citty
// tree.

import { CLI_SKILL_MD } from "@repo/app/node/guide/cli-skill";
import { describe, expect, it } from "vitest";
import { argsOf, collectLeafCommands } from "../command-tree";
import { testProgram } from "./command-tree";

describe("the served guide covers the command surface", () => {
  it("names every leaf command", () => {
    const commands = collectLeafCommands(testProgram());
    expect(commands.length).toBeGreaterThan(0);

    const unmentioned = commands
      .map(({ path }) => `inteligir ${path}`)
      .filter((invocation) => !CLI_SKILL_MD.includes(invocation));
    expect(unmentioned).toEqual([]);
  });

  it("names every flag every leaf accepts", () => {
    const undocumented: string[] = [];
    for (const { path, command } of collectLeafCommands(testProgram())) {
      for (const [name, arg] of Object.entries(argsOf(command))) {
        // Positionals are named by the invocation, not by a flag; `--help` and
        // `--version` are citty's own and documented once, not per command.
        if (arg.type === "positional") {
          continue;
        }
        const flag = `--${name}`;
        if (!CLI_SKILL_MD.includes(flag)) {
          undocumented.push(`${path} ${flag}`);
        }
      }
    }
    expect(undocumented).toEqual([]);
  });
});
