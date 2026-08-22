// Reading this CLI's own citty tree: the leaves it declares, the command an
// argv names, and the flags that command accepts.
//
// citty answers none of the three. `subCommands` is a RECORD rather than a
// list, every field is a `Resolvable` (a value, a promise, or a thunk), and
// the resolver `runMain` uses to find the deepest command for `--help` is
// internal. So the walk commander handed over as `.commands` and `.options`
// arrays lives here instead — with four consumers, which is why it is one
// module rather than four copies: `--help`, the unknown-flag gate, the guide's
// coverage test, and the `--json` enforcement test.

import type { ArgsDef, CommandDef, SubCommandsDef } from "citty";
import { invalidUsage } from "./cli-error";

export interface LeafCommand {
  /** Space-joined, as a user types it: `vault list`, `comment resolve`. */
  path: string;
  command: CommandDef;
}

export interface ResolvedCommand {
  command: CommandDef;
  /** The command one level up, which is what citty's usage renderer prefixes
   *  the name with. Undefined at the root. */
  parent: CommandDef | undefined;
  /** The argv left over once the command's own name is consumed — the tokens
   *  its `args` parse from. */
  rest: readonly string[];
}

/**
 * citty lets `subCommands` and `args` be lazy. This CLI declares neither
 * lazily, and the walk REFUSES the lazy form rather than reading past it: a
 * silently-skipped subtree would take its leaves out of the two fitness tests
 * that are the only reason those leaves stay honest.
 */
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

/** Every command with no subcommands of its own, deepest-first per branch. */
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

/**
 * The deepest command `rawArgs` names. The walk takes the first token that is
 * not a flag and descends when it names a subcommand — which is exact here
 * because every command that HAS subcommands declares no args of its own, so
 * no flag at those levels can be carrying a value that looks like a name.
 */
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

/** Every spelling `argsDef` makes reachable, plus the two citty answers itself. */
function declaredFlags(argsDef: ArgsDef): Set<string> {
  const names = new Set(["help", "version"]);
  for (const [name, def] of Object.entries(argsDef)) {
    if (def.type === "positional") {
      continue;
    }
    names.add(name);
    // citty aliases a name to its camelCase and kebab-case spellings, so both
    // reach the command and both have to pass this gate.
    names.add(name.replace(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`));
    names.add(name.replace(/-(\w)/gu, (_, letter: string) => letter.toUpperCase()));
    const alias = "alias" in def ? def.alias : undefined;
    for (const one of alias === undefined ? [] : Array.isArray(alias) ? alias : [alias]) {
      names.add(one);
    }
  }
  return names;
}

/**
 * Refuse a flag the command does not declare.
 *
 * citty hard-codes `strict: false` on node's `parseArgs`, so an undeclared
 * flag is parsed and then DROPPED — and `--contentt x` does not fail, it makes
 * `vault write` read stdin and exit 0. commander refused this for free; here
 * it is one gate in `runCli`, checked against the leaf the argv resolved to,
 * rather than a line every command has to remember. It is `invalid_usage`
 * (exit 1) and not an exit code of its own: 2 and 3 are spoken for.
 */
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
