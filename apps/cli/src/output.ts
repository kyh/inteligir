// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.
// (the single-JSON-output-path pattern its --json fitness test enforces).
//
// content (file bytes, snippets, the manual) goes through writeOut/writeLines raw: consola's reporter
// rewrites `backticks` and _underscores_ in every message it formats. `out` is for prose the CLI wrote itself.

import { createConsola, LogLevels } from "consola";

// pinned, not inferred: under NODE_ENV=test or CI consola falls back to the basic reporter (which prefixes
// `[log] `), drops the level to warn (silencing .log/.info/.success) and throttles repeats into "(repeated 6x)".
export const out = createConsola({ fancy: true, level: LogLevels.info, throttle: 0 });

export interface JsonOutputOptions {
  json?: boolean | undefined;
}

export const jsonArg = {
  json: { type: "boolean", description: "Print machine-readable JSON output" },
} as const;

// read off raw argv: a parse that fails still has to choose a shape.
export function wantsJsonOutput(rawArgs: readonly string[]): boolean {
  for (const raw of rawArgs) {
    if (raw === "--") {
      return false;
    }
    if (raw === "--json") {
      return true;
    }
    if (raw.startsWith("--json=")) {
      return raw.slice("--json=".length) !== "false";
    }
  }
  return false;
}

export function writeOut(text: string): void {
  process.stdout.write(text);
}

export function writeLines(lines: readonly string[]): void {
  if (lines.length === 0) {
    return;
  }
  process.stdout.write(`${lines.join("\n")}\n`);
}

// not a Record: a TypeScript interface satisfies no index signature, and every body is a contract interface.
type Printable = NonNullable<unknown>;

export function outputJson(opts: JsonOutputOptions, data: Printable): boolean {
  if (opts.json !== true) {
    return false;
  }
  process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
  return true;
}
