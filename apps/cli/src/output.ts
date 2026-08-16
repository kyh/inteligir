// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.
// (the single-JSON-output-path pattern its --json fitness test enforces).

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

interface ApiErrorLike {
  status: number;
  json(): Promise<unknown>;
}

/** Turn a non-2xx API response into the exit-1 refusal, preferring the
 *  contract's own display-safe message. */
export async function failFromResponse(response: ApiErrorLike): Promise<never> {
  const body: unknown = await response.json().catch(() => undefined);
  const parsed = apiErrorShapeSchema.safeParse(body);
  if (parsed.success) {
    throw new CliExitError(`${parsed.data.message} (${parsed.data.error})`);
  }
  throw new CliExitError(`The server answered HTTP ${response.status}`);
}
