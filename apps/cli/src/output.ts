// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.
// (the single-JSON-output-path pattern its --json fitness test enforces).
//
// THE two chokepoints every command goes through: `requireOk` is the only way
// a response body is reached, and `outputJson` the only way JSON is printed.
// The first exists because a body read WITHOUT a status check prints the
// server's error envelope as if it were the answer and exits 0 — a CLI that
// lies to a script. It is typed to make the honest path the only one that
// compiles: the ok-response is what comes back, so a command physically
// cannot call `.json()` on a refusal.
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

import { apiErrorResponseSchema } from "@repo/server-contract/errors";
import { createConsola, LogLevels } from "consola";
import { CliExitError } from "./cli-error";

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

/** The shape hono's client gives every response; `ok` is a LITERAL per status
 *  member, which is what lets `Extract` split success from refusal. Every route
 *  answers with a JSON object or array, so the body is read as `object` — the
 *  refusal path below parses it before reading a field. */
interface ResponseLike {
  ok: boolean;
  status: number;
  json(): Promise<object>;
}

/** A narrowing predicate rather than a cast — repo rule, and it is what makes
 *  the union split legible at every call site. */
function isOkResponse<TResponse extends ResponseLike>(
  response: TResponse,
): response is Extract<TResponse, { ok: true }> {
  return response.ok;
}

/**
 * The status gate. Returns the SUCCESS member of the response union — so the
 * caller's `.json()` is typed to the 200 body and a refusal can never be
 * printed as an answer — and throws the server's own error class otherwise.
 */
export async function requireOk<TResponse extends ResponseLike>(
  response: TResponse,
): Promise<Extract<TResponse, { ok: true }>> {
  if (isOkResponse(response)) {
    return response;
  }
  const body: unknown = await response.json().catch(() => undefined);
  const parsed = apiErrorResponseSchema.safeParse(body);
  if (parsed.success) {
    throw new CliExitError(parsed.data.message, { code: parsed.data.error });
  }
  throw new CliExitError(`The server answered HTTP ${response.status}`, {
    code: `http_${response.status}`,
  });
}

// There is deliberately no `okJson(response)` convenience beside this. Such a
// helper cannot type its own body without a cast — inside a generic function
// the narrowed `json()` resolves through the CONSTRAINT (`Promise<unknown>`),
// so the sugar would either return `unknown` or need an assertion this repo
// does not allow. Two lines at each call site keep the status check visible
// and the body exactly typed.
