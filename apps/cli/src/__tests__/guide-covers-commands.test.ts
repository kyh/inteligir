// reads the rendered markdown, not the guide module's source: a comment naming a command satisfies a source check.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CLI_SKILL_MD } from "../server/guide/cli-skill";
import { describe, expect, it } from "vitest";
import { argsOf, collectLeafCommands, declaredFlags } from "../command-tree";
import { testProgram } from "./command-tree";

const README_PATH = fileURLToPath(new URL("../../README.md", import.meta.url));
const SURFACE_HEADING = "## Command surface\n\n";
// `<verb>` or `<group> <leaf>|<leaf>…`; any other span in the list (`tag:`) is prose about a verb
const COMMAND_SPAN = /^[a-z]+(?:\s+[a-z]+(?:\|[a-z]+)*)?$/u;

// the list is the paragraph under the heading, so the exit-code line's `action wait` is not a listing
const readmeCommandPaths = (): string[] => {
  const readme = readFileSync(README_PATH, "utf-8");
  const start = readme.indexOf(SURFACE_HEADING);
  if (start === -1) {
    throw new Error(`${README_PATH} has no "${SURFACE_HEADING.trim()}" section`);
  }
  const list = readme.slice(start + SURFACE_HEADING.length).split("\n\n")[0] ?? "";
  return [...list.matchAll(/`(?<span>[^`]+)`/gu)]
    .map((match) => match.groups?.span ?? "")
    .filter((span) => COMMAND_SPAN.test(span))
    .flatMap((span) => {
      const [group = "", leaves] = span.split(/\s+/u);
      return leaves === undefined ? [group] : leaves.split("|").map((leaf) => `${group} ${leaf}`);
    });
};

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

describe("the README's command surface is the command tree", () => {
  it("lists every leaf command, and nothing the CLI would refuse", () => {
    const leaves = collectLeafCommands(testProgram()).map(({ path }) => path);
    const listed = readmeCommandPaths();
    expect(
      {
        invented: listed.filter((path) => !leaves.includes(path)),
        unlisted: leaves.filter((path) => !listed.includes(path)),
      },
      "rule: apps/cli/README.md § Command surface spells every leaf of src/program.ts's tree, as `<verb>` or `<group> <leaf>|<leaf>`",
    ).toEqual({ invented: [], unlisted: [] });
  });
});
