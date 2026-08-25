// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.
// (the single-JSON-output-path pattern its --json fitness test enforces).
//
// THE chokepoint every command goes through: `outputJson` is the only way JSON
// is printed, so stdout stays one JSON value without any command having to
// remember it. The other invariant — a refusal must never print as an answer —
// no longer needs a helper at all: a refused procedure THROWS, so there is no
// body for a command to reach (`program.ts` states where that lands).
//
// Stdout has TWO writers and which one a line takes is decided by what the
// line IS, not by who prints it:
//
//   - `writeOut`/`writeLines` for anything derived from vault or server
//     CONTENT — file bytes, snippets, diffs, timelines, the manual. Raw, and
//     it has to be: consola's reporter rewrites `backticks` and _underscores_
//     in every message it formats, and a note's own text contains both.
//   - `out` (consola) for prose this CLI wrote itself — an outcome, a note, a
//     refusal.
//
// `--json` mode uses NEITHER: `outputJson` writes the document and returns,
// so stdout stays one JSON value without any command having to remember it.

import { createConsola, LogLevels } from "consola";

/**
 * The CLI's consola. Every option here is PINNED rather than inferred, because
 * consola derives all three from the environment and the derived answers
 * differ between a test run and a real one:
 *
 *   - the reporter falls back to the basic one under `NODE_ENV=test` and in
 *     CI, and that one prefixes every message with its type (`[log] …`) — so
 *     the goldens would pin bytes no user ever sees. The fancy reporter is
 *     also the LESS decorated of the two for `.log`, which prints bare.
 *   - the level falls to `warn` under the same condition, which silences
 *     `.log`, `.info` and `.success` outright.
 *   - throttling collapses a repeated line into "(repeated 6x)"; a CLI told to
 *     print the same path six times prints it six times.
 */
export const out = createConsola({ fancy: true, level: LogLevels.info, throttle: 0 });

export interface JsonOutputOptions {
  json?: boolean | undefined;
}

/** The `--json` flag every leaf declares, spread into its citty `args` so the
 *  one spelling the enforcement test walks for is the one they all carry. */
export const jsonArg = {
  json: { type: "boolean", description: "Print machine-readable JSON output" },
} as const;

/**
 * Which SHAPE a failure has to print in, read off the raw argv rather than off
 * a parsed flag. It has to be answerable before parsing, because a parse that
 * fails still has to choose a shape — and the flag's spelling is safe to read
 * this way precisely because `json-flag-enforcement.test.ts` proves every leaf
 * declares `--json`, as a boolean, under exactly this name.
 */
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

/** Content, exactly these bytes and no others. */
export function writeOut(text: string): void {
  process.stdout.write(text);
}

/** Content, one line each. */
export function writeLines(lines: readonly string[]): void {
  if (lines.length === 0) {
    return;
  }
  process.stdout.write(`${lines.join("\n")}\n`);
}

/** Anything a command prints under `--json`. Every caller hands over a body
 *  the typed client already gave a contract type, and a TypeScript interface
 *  satisfies no index signature — so the bound this can state is that the
 *  value exists. */
type Printable = NonNullable<unknown>;

/**
 * Print data as JSON and return true, or return false when --json was not
 * requested. The ONE JSON output path for every command, so the fitness test
 * walking the flags is also a statement about behavior.
 */
export function outputJson(opts: JsonOutputOptions, data: Printable): boolean {
  if (opts.json !== true) {
    return false;
  }
  process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
  return true;
}
