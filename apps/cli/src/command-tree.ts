// citty exposes no tree walk: `subCommands` is a record of Resolvables and runMain's deepest-command resolver is internal.

import type { ArgDef, ArgsDef, CommandDef, SubCommandsDef } from "citty";
import { invalidUsage } from "./cli-error";

export interface CommandAtPath {
  path: string;
  command: CommandDef;
}

export interface ResolvedCommand {
  command: CommandDef;
  parent: CommandDef | undefined;
  rest: readonly string[];
}

const refuseLazy: (field: string) => never = (field) => {
  throw new Error(
    `${field} must be declared eagerly — the tree walk (help resolution, the ` +
      `guide's coverage test and the --json enforcement test) reads it synchronously`,
  );
};

const subCommandsOf = (command: CommandDef): SubCommandsDef | undefined => {
  const value = command.subCommands;
  if (value === undefined) {
    return undefined;
  }
  if (value instanceof Function || value instanceof Promise) {
    return refuseLazy("subCommands");
  }
  return value;
};

const commandOf = (value: SubCommandsDef[string]): CommandDef => {
  if (value instanceof Function || value instanceof Promise) {
    return refuseLazy("a subCommands entry");
  }
  return value;
};

export const argsOf = (command: CommandDef): ArgsDef => {
  const value = command.args;
  if (value === undefined) {
    return {};
  }
  if (value instanceof Function || value instanceof Promise) {
    return refuseLazy("args");
  }
  return value;
};

export const collectLeafCommands = (command: CommandDef, prefix = ""): CommandAtPath[] => {
  const subCommands = subCommandsOf(command);
  if (subCommands === undefined) {
    return [];
  }
  const results: CommandAtPath[] = [];
  for (const [name, entry] of Object.entries(subCommands)) {
    const sub = commandOf(entry);
    const path = prefix.length > 0 ? `${prefix} ${name}` : name;
    const nested = collectLeafCommands(sub, path);
    if (nested.length === 0) {
      results.push({ command: sub, path });
    } else {
      results.push(...nested);
    }
  }
  return results;
};

// the root and every command that routes to others, each path spelled as a user types it.
export const collectGroupCommands = (command: CommandDef, path = "inteligir"): CommandAtPath[] => {
  const subCommands = subCommandsOf(command);
  if (subCommands === undefined) {
    return [];
  }
  return [
    { command, path },
    ...Object.entries(subCommands).flatMap(([name, entry]) =>
      collectGroupCommands(commandOf(entry), `${path} ${name}`),
    ),
  ];
};

// exact only because no command with subcommands declares args, so no flag value at those levels can look like a name.
export const resolveCommandPath = (
  root: CommandDef,
  rawArgs: readonly string[],
): ResolvedCommand => {
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
};

const spellingsOf = (name: string, def: ArgDef): string[] => {
  const spellings = [
    name,
    // citty aliases each name to its camelCase and kebab-case spellings.
    name.replaceAll(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`),
    name.replaceAll(/-(?<letter>\w)/gu, (_, letter: string) => letter.toUpperCase()),
  ];
  const alias = "alias" in def ? def.alias : undefined;
  if (alias !== undefined) {
    spellings.push(...(Array.isArray(alias) ? alias : [alias]));
  }
  return spellings;
};

// citty's two built-ins, which every command answers and no leaf declares itself.
export const HELP_FLAGS: ReadonlySet<string> = new Set(["--help", "-h"]);
export const VERSION_FLAGS: ReadonlySet<string> = new Set(["--version", "-v"]);

export const declaredFlags = (argsDef: ArgsDef): Set<string> => {
  const names = new Set(
    [...HELP_FLAGS, ...VERSION_FLAGS]
      .filter((flag) => flag.startsWith("--"))
      .map((flag) => flag.slice(2)),
  );
  for (const [name, def] of Object.entries(argsDef)) {
    if (def.type !== "positional") {
      for (const spelling of spellingsOf(name, def)) {
        names.add(spelling);
      }
    }
  }
  return names;
};

const valueFlags = (argsDef: ArgsDef): Set<string> =>
  new Set(
    Object.entries(argsDef).flatMap(([name, def]) =>
      def.type === "string" || def.type === "enum" ? spellingsOf(name, def) : [],
    ),
  );

interface ArgvTokens {
  flags: string[];
  positionals: string[];
}

// the split citty's parse makes before `--`: node's parseArgs hands a string or enum flag written without
// `=` the next token whatever it looks like, and reads every other dash-led token but a lone `-` as a flag.
const splitArgv = (rawArgs: readonly string[], argsDef: ArgsDef): ArgvTokens => {
  const valued = valueFlags(argsDef);
  const tokens: ArgvTokens = { flags: [], positionals: [] };
  let valuePending = false;
  for (const raw of rawArgs) {
    if (valuePending) {
      valuePending = false;
      continue;
    }
    if (raw === "--") {
      break;
    }
    if (raw === "-" || !raw.startsWith("-")) {
      tokens.positionals.push(raw);
      continue;
    }
    tokens.flags.push(raw);
    valuePending = !raw.includes("=") && valued.has(raw.replace(/^--?/u, ""));
  }
  return tokens;
};

const isDeclaredFlag = (raw: string, declared: ReadonlySet<string>): boolean => {
  if (HELP_FLAGS.has(raw) || VERSION_FLAGS.has(raw)) {
    return true;
  }
  if (!raw.startsWith("--")) {
    const letters = raw.slice(1);
    return letters.length === 1 && declared.has(letters);
  }
  const flag = raw.slice(2).split("=")[0] ?? "";
  // `--no-x` is citty's negation of the boolean `x`.
  return declared.has(flag) || (flag.startsWith("no-") && declared.has(flag.slice(3)));
};

// citty runs parseArgs with `strict: false`, so an undeclared flag is dropped: `--contentt x` would make
// `vault write` read stdin and exit 0, and `-n 5` would be an unread boolean and a stray word.
export const assertKnownFlags = (rawArgs: readonly string[], argsDef: ArgsDef): void => {
  const declared = declaredFlags(argsDef);
  const unknown = splitArgv(rawArgs, argsDef)
    .flags.filter((raw) => !isDeclaredFlag(raw, declared))
    .map((raw) => raw.split("=")[0] ?? raw);
  if (unknown.length > 0) {
    throw invalidUsage(`unknown option${unknown.length > 1 ? "s" : ""}: ${unknown.join(" ")}`);
  }
};

// citty binds positionals in order and drops the rest, so `search a b` would search for `a` alone. only the
// words before `--` count: what follows it is a leaf's own channel (`connectors add x -- npx -y srv`).
export const assertPositionalArity = (rest: readonly string[], argsDef: ArgsDef): void => {
  const declared = Object.values(argsDef).filter((def) => def.type === "positional").length;
  const extra = splitArgv(rest, argsDef).positionals.slice(declared);
  if (extra.length > 0) {
    throw invalidUsage(
      `unexpected argument${extra.length > 1 ? "s" : ""}: ${extra.join(" ")} — quote a value that contains spaces`,
    );
  }
};
