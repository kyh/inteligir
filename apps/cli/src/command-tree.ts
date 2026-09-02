// citty exposes no tree walk: `subCommands` is a record of Resolvables and runMain's deepest-command resolver is internal.

import type { ArgsDef, CommandDef, SubCommandsDef } from "citty";
import { invalidUsage } from "./cli-error";

export interface LeafCommand {
  path: string;
  command: CommandDef;
}

export interface ResolvedCommand {
  command: CommandDef;
  parent: CommandDef | undefined;
  rest: readonly string[];
}

function refuseLazy(field: string): never {
  throw new Error(
    `${field} must be declared eagerly — the tree walk (help resolution, the ` +
      `guide's coverage test and the --json enforcement test) reads it synchronously`,
  );
}

function subCommandsOf(command: CommandDef): SubCommandsDef | undefined {
  const value = command.subCommands;
  if (value === undefined) {
    return undefined;
  }
  if (value instanceof Function || value instanceof Promise) {
    return refuseLazy("subCommands");
  }
  return value;
}

function commandOf(value: SubCommandsDef[string]): CommandDef {
  if (value instanceof Function || value instanceof Promise) {
    return refuseLazy("a subCommands entry");
  }
  return value;
}

export function argsOf(command: CommandDef): ArgsDef {
  const value = command.args;
  if (value === undefined) {
    return {};
  }
  if (value instanceof Function || value instanceof Promise) {
    return refuseLazy("args");
  }
  return value;
}

export function collectLeafCommands(command: CommandDef, prefix = ""): LeafCommand[] {
  const subCommands = subCommandsOf(command);
  if (subCommands === undefined) {
    return [];
  }
  const results: LeafCommand[] = [];
  for (const [name, entry] of Object.entries(subCommands)) {
    const sub = commandOf(entry);
    const path = prefix.length > 0 ? `${prefix} ${name}` : name;
    const nested = collectLeafCommands(sub, path);
    if (nested.length === 0) {
      results.push({ path, command: sub });
    } else {
      results.push(...nested);
    }
  }
  return results;
}

// exact only because no command with subcommands declares args, so no flag value at those levels can look like a name.
export function resolveCommandPath(root: CommandDef, rawArgs: readonly string[]): ResolvedCommand {
  let command = root;
  let parent: CommandDef | undefined;
  let rest = rawArgs;
  for (;;) {
    const subCommands = subCommandsOf(command);
    if (subCommands === undefined) {
      return { command, parent, rest };
    }
    const index = rest.findIndex((token) => !token.startsWith("-"));
    const name = index === -1 ? undefined : rest[index];
    const entry = name === undefined ? undefined : subCommands[name];
    if (entry === undefined) {
      return { command, parent, rest };
    }
    parent = command;
    command = commandOf(entry);
    rest = rest.slice(index + 1);
  }
}

export function declaredFlags(argsDef: ArgsDef): Set<string> {
  const names = new Set(["help", "version"]);
  for (const [name, def] of Object.entries(argsDef)) {
    if (def.type === "positional") {
      continue;
    }
    names.add(name);
    // citty aliases each name to its camelCase and kebab-case spellings.
    names.add(name.replace(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`));
    names.add(name.replace(/-(\w)/gu, (_, letter: string) => letter.toUpperCase()));
    const alias = "alias" in def ? def.alias : undefined;
    for (const one of alias === undefined ? [] : Array.isArray(alias) ? alias : [alias]) {
      names.add(one);
    }
  }
  return names;
}

// citty runs parseArgs with `strict: false`, so an undeclared flag is dropped: `--contentt x` would make
// `vault write` read stdin and exit 0.
export function assertKnownFlags(rawArgs: readonly string[], argsDef: ArgsDef): void {
  const declared = declaredFlags(argsDef);
  const unknown: string[] = [];
  for (const raw of rawArgs) {
    if (raw === "--") {
      break;
    }
    if (!raw.startsWith("--") || raw === "--") {
      continue;
    }
    const flag = raw.slice(2).split("=")[0] ?? "";
    if (flag.length === 0 || declared.has(flag)) {
      continue;
    }
    // `--no-x` is citty's negation of the boolean `x`.
    if (flag.startsWith("no-") && declared.has(flag.slice(3))) {
      continue;
    }
    unknown.push(`--${flag}`);
  }
  if (unknown.length > 0) {
    throw invalidUsage(`unknown option${unknown.length > 1 ? "s" : ""}: ${unknown.join(" ")}`);
  }
}
