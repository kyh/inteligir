// reads the rendered markdown, not the guide module's source: a comment naming a command satisfies a source check.

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
        // positionals are named by the invocation, not by a flag.
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
    // the union across leaves: a flag is documented once and several commands may declare it.
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
