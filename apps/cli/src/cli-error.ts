// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.
// (action wrapper shape + fetch-cause unwrapping); the exit-code table and
// the error CLASSES are this CLI's own and are documented in the served
// guide (cli-skill.ts).

export const EXIT_ERROR = 1;
export const EXIT_WAIT_TIMEOUT = 2;
export const EXIT_UNREACHABLE = 3;

/**
 * A machine-readable failure class, so `--json` callers can branch without
 * parsing prose. Server refusals pass the SERVER's own class through
 * (`NOT_FOUND`, `BAD_REQUEST`, …) rather than being flattened into one CLI
 * code — which is why the CLI's own classes are spelled the same way. One
 * vocabulary, one casing, whichever side raised it.
 */
export class CliExitError extends Error {
  readonly exitCode: number;
  readonly code: string;

  constructor(message: string, options: { code: string; exitCode?: number }) {
    super(message);
    this.name = "CliExitError";
    this.code = options.code;
    this.exitCode = options.exitCode ?? EXIT_ERROR;
  }
}

/** Local refusal: bad flags, contradictory arguments, oversized input. */
export function invalidUsage(message: string): CliExitError {
  return new CliExitError(message, { code: "INVALID_USAGE" });
}

/**
 * Node's fetch says "fetch failed" and keeps the actionable socket errors
 * under `cause`. Multi-address connections use an AggregateError, so walk
 * both links while guarding against malformed cyclic error graphs.
 */
export function getErrorMessage(cause: unknown): string {
  if (!(cause instanceof Error)) {
    return String(cause);
  }
  const seen = new Set<Error>();
  const messages: string[] = [];
  const pending: Error[] = [cause];

  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined || seen.has(current)) {
      continue;
    }
    seen.add(current);
    if (current.message.length > 0) {
      messages.push(current.message);
    }
    const children: Error[] = [];
    if (current.cause instanceof Error) {
      children.push(current.cause);
    }
    if (current instanceof AggregateError) {
      children.push(...current.errors.filter((nested): nested is Error => nested instanceof Error));
    }
    for (let index = children.length - 1; index >= 0; index -= 1) {
      const child = children[index];
      if (child !== undefined) {
        pending.push(child);
      }
    }
  }
  return messages.join(": ");
}
