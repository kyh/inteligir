// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.
// (action wrapper shape + fetch-cause unwrapping); the exit-code table is
// this CLI's own and is documented in the served guide (cli-skill.ts).

export const EXIT_ERROR = 1;
export const EXIT_WAIT_TIMEOUT = 2;
export const EXIT_UNREACHABLE = 3;

export class CliExitError extends Error {
  readonly exitCode: number;
  constructor(message: string, exitCode: number = EXIT_ERROR) {
    super(message);
    this.name = "CliExitError";
    this.exitCode = exitCode;
  }
}

/**
 * Node's fetch says "fetch failed" and keeps the actionable socket errors
 * under `cause`. Multi-address connections use an AggregateError, so walk
 * both links while guarding against malformed cyclic error graphs.
 */
export function getErrorMessage(err: unknown): string {
  if (!(err instanceof Error)) {
    return String(err);
  }
  const seen = new Set<Error>();
  const messages: string[] = [];
  const pending: Error[] = [err];

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
