// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.
// (action wrapper shape + fetch-cause unwrapping); the exit-code table and
// the error CLASSES are this CLI's own and are documented in the served
// guide (cli-skill.ts).

import { z } from "zod";

export const EXIT_ERROR = 1;
export const EXIT_WAIT_TIMEOUT = 2;
export const EXIT_UNREACHABLE = 3;

// server refusals keep the server's own class (`NOT_FOUND`, …), so the CLI's own classes share that spelling.
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

export function invalidUsage(message: string): CliExitError {
  return new CliExitError(message, { code: "INVALID_USAGE" });
}

const UNREACHABLE_ERRNOS = ["ECONNREFUSED", "ECONNRESET", "ENOTFOUND", "EHOSTUNREACH"];
const errnoSchema = z.object({ code: z.enum(UNREACHABLE_ERRNOS) });

// a crash leaves server.json behind, so a stale row and a refused dial is the ordinary "no server"
// and must read as SERVER_UNREACHABLE rather than UNEXPECTED.
export function isUnreachable(cause: unknown): boolean {
  if (!(cause instanceof Error)) {
    return false;
  }
  const seen = new Set<Error>();
  const pending: Error[] = [cause];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined || seen.has(current)) {
      continue;
    }
    seen.add(current);
    if (errnoSchema.safeParse(current).success) {
      return true;
    }
    if (current.cause instanceof Error) {
      pending.push(current.cause);
    }
    if (current instanceof AggregateError) {
      pending.push(...current.errors.filter((nested): nested is Error => nested instanceof Error));
    }
  }
  return false;
}

// node's fetch says "fetch failed" and keeps the socket error under `cause`; multi-address dials wrap an AggregateError.
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
