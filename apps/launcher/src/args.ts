// The launcher's whole command line, parsed once into a closed set of
// outcomes. Pure: no filesystem, no environment, no process — so the boot
// entry only has to act on a decision this module already made, and every
// refusal is a unit test rather than a wrong directory on someone's machine.

import { isAbsolute, resolve } from "node:path";

export interface BootOptions {
  /** null = let the app's own resolution decide (config.json, then 4664). */
  port: number | null;
  /** As TYPED — resolution against a cwd is `resolveLauncherEnv`'s job. */
  dataDir: string | null;
  vaultDir: string | null;
  /** --no-open turns this off; opening is the default because the whole point
   *  of `npx inteligir` is landing in the app. */
  open: boolean;
}

export type LauncherCommand =
  | { kind: "boot"; options: BootOptions }
  | { kind: "help" }
  | { kind: "version" }
  | { kind: "error"; message: string };

export const LAUNCHER_USAGE = `inteligir — run the notes app on this machine

Usage
  npx inteligir [options]

Options
  --port <n>         TCP port for the local server (default 4664)
  --data-dir <path>  Where the database and settings live (default ~/.inteligir)
  --vault <path>     The vault: your markdown files (default ~/Inteligir)
  --no-open          Do not open a browser once the server is listening
  -v, --version      Print the version and exit
  -h, --help         Print this help and exit

The agent-facing CLI ships inside this package and is a different program;
the agent reaches it on its own PATH. See the README.`;

const VALUE_FLAGS = {
  "--port": "port",
  "--data-dir": "dataDir",
  "--vault": "vaultDir",
} as const;

type ValueFlag = keyof typeof VALUE_FLAGS;

function isValueFlag(token: string): token is ValueFlag {
  return Object.hasOwn(VALUE_FLAGS, token);
}

/** A flag's value, or the refusal to print instead. Tagged, so the caller
 *  branches on the outcome rather than on the value's representation. */
type FlagValue<T> = { ok: true; value: T } | { ok: false; error: string };

function parsePort(raw: string): FlagValue<number> {
  const port = Number(raw);
  if (String(port) !== raw || !Number.isInteger(port) || port < 1 || port > 65_535) {
    return { ok: false, error: `--port must be a valid TCP port (got "${raw}")` };
  }
  return { ok: true, value: port };
}

function parseNonEmpty(flag: string, raw: string): FlagValue<string> {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: `${flag} must not be empty` };
  }
  return { ok: true, value: trimmed };
}

/** `argv` is the arguments only — slice off the node executable and the entry
 *  before calling. */
export function parseLauncherArgs(argv: readonly string[]): LauncherCommand {
  const options: BootOptions = { port: null, dataDir: null, vaultDir: null, open: true };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === undefined) {
      continue;
    }

    if (token === "-h" || token === "--help") {
      return { kind: "help" };
    }
    if (token === "-v" || token === "--version") {
      return { kind: "version" };
    }
    if (token === "--no-open") {
      options.open = false;
      continue;
    }

    // `--flag=value` and `--flag value` are the same flag; split once here so
    // the two spellings can never drift apart below.
    const equalsAt = token.indexOf("=");
    const flag = token.startsWith("--") && equalsAt > 0 ? token.slice(0, equalsAt) : token;
    if (!isValueFlag(flag)) {
      return {
        kind: "error",
        message: token.startsWith("-")
          ? `Unknown option "${token}". Run \`inteligir --help\`.`
          : `Unexpected argument "${token}". The launcher takes options only — \`inteligir --help\` lists them.`,
      };
    }

    let raw: string;
    if (equalsAt > 0) {
      raw = token.slice(equalsAt + 1);
    } else {
      const next = argv[index + 1];
      if (next === undefined || next.startsWith("-")) {
        return { kind: "error", message: `${flag} needs a value.` };
      }
      raw = next;
      index += 1;
    }

    const key = VALUE_FLAGS[flag];
    if (key === "port") {
      const parsed = parsePort(raw);
      if (!parsed.ok) {
        return { kind: "error", message: parsed.error };
      }
      options.port = parsed.value;
      continue;
    }
    const parsed = parseNonEmpty(flag, raw);
    if (!parsed.ok) {
      return { kind: "error", message: parsed.error };
    }
    options[key] = parsed.value;
  }

  return { kind: "boot", options };
}

/** The INTELIGIR_* variables the launcher sets; an option left at its default
 *  contributes no key, so the app's own resolution still decides it. */
export interface LauncherEnv {
  INTELIGIR_PORT?: string;
  INTELIGIR_DATA_DIR?: string;
  INTELIGIR_VAULT_DIR?: string;
}

export interface ResolveLauncherEnvArgs {
  options: BootOptions;
  /** Where the user ran the command — what a relative path is relative TO. */
  cwd: string;
}

/**
 * The INTELIGIR_* overrides the boot inherits. A relative `--data-dir docs`
 * is resolved HERE, against the invoking cwd, because the app refuses a
 * relative path outright (it would otherwise anchor to whatever directory the
 * server process happened to start in) and "must be absolute" is a poor answer
 * to a path the user can see from where they are standing. `~` is left alone:
 * the app's own config layer expands it, and expanding it twice is how a
 * literal `~` directory gets created.
 */
export function resolveLauncherEnv(args: ResolveLauncherEnvArgs): LauncherEnv {
  const env: LauncherEnv = {};
  if (args.options.port !== null) {
    env.INTELIGIR_PORT = String(args.options.port);
  }
  if (args.options.dataDir !== null) {
    env.INTELIGIR_DATA_DIR = resolvePathArg(args.options.dataDir, args.cwd);
  }
  if (args.options.vaultDir !== null) {
    env.INTELIGIR_VAULT_DIR = resolvePathArg(args.options.vaultDir, args.cwd);
  }
  return env;
}

function resolvePathArg(value: string, cwd: string): string {
  if (value === "~" || value.startsWith("~/")) {
    return value;
  }
  return isAbsolute(value) ? value : resolve(cwd, value);
}
