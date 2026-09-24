// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.
// (action wrapper shape + fetch-cause unwrapping); the exit-code table and
// the error CLASSES are this CLI's own and are documented in the served
// guide (cli-skill.ts).

import { ORPCError } from "@orpc/client";
import { z } from "zod";

export const EXIT_ERROR = 1;
const EXIT_WAIT_TIMEOUT = 2;
export const EXIT_UNREACHABLE = 3;
const EXIT_AWAITING_INTERACTION = 4;
// the shell's own number for a run ended by ^C: 128 + SIGINT.
const EXIT_INTERRUPTED = 130;

// every class the CLI raises itself, and the exit code it carries: a class cannot leave with another's code.
export const CLI_FAILURE_EXIT_CODES = {
  AWAITING_INTERACTION: EXIT_AWAITING_INTERACTION,
  INTERRUPTED: EXIT_INTERRUPTED,
  INVALID_USAGE: EXIT_ERROR,
  NOT_FOUND: EXIT_ERROR,
  SEND_FAILED: EXIT_ERROR,
  SERVER_UNREACHABLE: EXIT_UNREACHABLE,
  SERVER_VERSION_MISMATCH: EXIT_UNREACHABLE,
  THREAD_ERROR: EXIT_ERROR,
  UNEXPECTED: EXIT_ERROR,
  UNEXPECTED_RESPONSE: EXIT_ERROR,
  WAIT_TIMEOUT: EXIT_WAIT_TIMEOUT,
} as const;
export type CliFailureCode = keyof typeof CLI_FAILURE_EXIT_CODES;

// a server refusal re-raised in the CLI's own words keeps the server's class and exits as the refusal itself would.
export type CliFailure = { code: CliFailureCode } | { serverClass: string };

// unparameterised, `instanceof ORPCError` narrows `code` to `any`.
export const isOrpcError = (cause: unknown): cause is ORPCError<string, unknown> =>
  cause instanceof ORPCError;

export const failureFrom = (cause: unknown, fallback: CliFailureCode): CliFailure =>
  isOrpcError(cause) ? { serverClass: cause.code } : { code: fallback };

// server refusals keep the server's own class (`NOT_FOUND`, …), so the CLI's own classes share that spelling.
export class CliExitError extends Error {
  readonly exitCode: number;
  readonly code: string;

  constructor(message: string, failure: CliFailure) {
    super(message);
    this.name = "CliExitError";
    if ("serverClass" in failure) {
      this.code = failure.serverClass;
      this.exitCode = EXIT_ERROR;
    } else {
      this.code = failure.code;
      this.exitCode = CLI_FAILURE_EXIT_CODES[failure.code];
    }
  }
}

export const invalidUsage = (message: string): CliExitError =>
  new CliExitError(message, { code: "INVALID_USAGE" });

export const START_SERVER_HINT = "Start one with `inteligir serve` (or open Inteligir)";

const UNREACHABLE_ERRNOS = ["ECONNREFUSED", "ECONNRESET", "ENOTFOUND", "EHOSTUNREACH"];
const errnoSchema = z.object({ code: z.enum(UNREACHABLE_ERRNOS) });

// depth-first in message order: an error, then its cause, then an AggregateError's children; a cycle is walked once.
const errorChain = (root: Error): Error[] => {
  const seen = new Set<Error>();
  const chain: Error[] = [];
  const pending: Error[] = [root];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined || seen.has(current)) {
      continue;
    }
    seen.add(current);
    chain.push(current);
    const children: Error[] = [];
    if (current.cause instanceof Error) {
      children.push(current.cause);
    }
    if (current instanceof AggregateError) {
      children.push(...current.errors.filter((nested): nested is Error => nested instanceof Error));
    }
    pending.push(...children.toReversed());
  }
  return chain;
};

// a crash leaves server.json behind, so a stale row and a refused dial is the ordinary "no server"
// and must read as SERVER_UNREACHABLE rather than UNEXPECTED.
export const isUnreachable = (cause: unknown): boolean =>
  cause instanceof Error && errorChain(cause).some((error) => errnoSchema.safeParse(error).success);

// node's fetch says "fetch failed" and keeps the socket error under `cause`; multi-address dials wrap an AggregateError.
export const getErrorMessage = (cause: unknown): string =>
  cause instanceof Error
    ? errorChain(cause)
        .map((error) => error.message)
        .filter((message) => message.length > 0)
        .join(": ")
    : String(cause);
