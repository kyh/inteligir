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
// receives from system.guide — and the inventory comes from the citty
// tree.

import { CLI_SKILL_MD } from "../server/guide/cli-skill";
import { describe, expect, it } from "vitest";
import { argsOf, collectLeafCommands, declaredFlags } from "../command-tree";
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

  it("names no flag the CLI would refuse", () => {
    // The UNION, not per-leaf: a flag is documented once and several commands
    // may declare it, so the only honest question is whether ANY leaf accepts
    // the spelling — which is what `assertKnownFlags` asks of the leaf that
    // actually runs. `declaredFlags` carries citty's own `--help`/`--version`
    // and the kebab/camel aliases with it.
    const accepted = new Set<string>();
    for (const { command } of collectLeafCommands(testProgram())) {
      for (const flag of declaredFlags(argsOf(command))) {
        accepted.add(flag);
      }
    }

    const named = CLI_SKILL_MD.match(/--[a-z][\w-]*/gu) ?? [];
    const invented = [...new Set(named.map((token) => token.slice(2)))].filter(
      (flag) => !accepted.has(flag),
    );
    expect(invented).toEqual([]);
  });
});
