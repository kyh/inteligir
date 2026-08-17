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

import { z } from "zod";
import { CliExitError } from "./cli-error";

export interface JsonOutputOptions {
  json?: boolean;
}

/**
 * Print data as JSON and return true, or return false when --json was not
 * requested. The ONE JSON output path for every command, so the fitness test
 * walking the flags is also a statement about behavior.
 */
export function outputJson(opts: JsonOutputOptions, data: unknown): boolean {
  if (opts.json !== true) {
    return false;
  }
  console.log(JSON.stringify(data, null, 2));
  return true;
}

/** Every non-2xx API body starts with these two fields; LENIENT on extras
 *  (the vault write 409 carries `current` beside them). */
const apiErrorShapeSchema = z.object({
  error: z.string().min(1),
  message: z.string(),
});

/** The shape hono's client gives every response; `ok` is a LITERAL per status
 *  member, which is what lets `Extract` split success from refusal. */
interface ResponseLike {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
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
  const parsed = apiErrorShapeSchema.safeParse(body);
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
