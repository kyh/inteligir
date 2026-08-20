// Drives the REAL program object (same assembly the bin runs) with injected
// deps and captured output, returning the exit code as a value.

import { Readable } from "node:stream";
import { vi } from "vitest";
import type { CliDeps } from "../context";
import { runCli } from "../program";

/**
 * consola colors its own decoration when it is talking to a TTY, and turns it
 * off when it is not — so the same command emits different BYTES depending on
 * whether a suite runs under a terminal or a pipe. Stripping the escapes is
 * what lets the goldens below stay exact about everything else, which is the
 * half that is actually the CLI's contract.
 *
 * Built rather than written as a literal, because an escape BYTE sitting in a
 * regex literal is exactly what `no-control-regex` exists to catch: it is
 * invisible in every diff that carries it.
 */
const ANSI = new RegExp(`${String.fromCodePoint(0x1b)}\\[[0-9;]*m`, "gu");

export interface CliRunResult {
  code: number;
  /** Everything the command wrote to stdout, colour stripped. */
  stdout: string;
  stderr: string;
}

export interface RunArgs {
  argv: string[];
  baseUrl: string;
  env?: Record<string, string>;
  /** stdin bytes for the commands that read it (`vault write`). */
  stdin?: Uint8Array;
}

export async function runCliForTest(args: RunArgs): Promise<CliRunResult> {
  const deps: CliDeps = {
    env: { INTELIGIR_SERVER_URL: args.baseUrl, ...args.env },
    resolveServer: async () => ({ baseUrl: args.baseUrl, source: "explicit" }),
  };
  let stdout = "";
  let stderr = "";
  // Both streams are captured by DESCRIPTOR rather than by console spy:
  // nothing in the CLI reaches for `console` any more — consola writes to the
  // stream object it was constructed with, which is this one.
  const outSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    stdout += chunk instanceof Uint8Array ? new TextDecoder().decode(chunk) : chunk;
    return true;
  });
  const errSpy = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    stderr += chunk instanceof Uint8Array ? new TextDecoder().decode(chunk) : chunk;
    return true;
  });
  // process.stdin is a getter, so it is swapped by descriptor rather than a
  // spy; the original descriptor goes back in `finally`.
  const stdinDescriptor =
    args.stdin === undefined ? undefined : Object.getOwnPropertyDescriptor(process, "stdin");
  if (args.stdin !== undefined) {
    Object.defineProperty(process, "stdin", {
      configurable: true,
      value: Readable.from([Buffer.from(args.stdin)]),
    });
  }
  try {
    const code = await runCli(["node", "inteligir", ...args.argv], deps);
    return { code, stdout: stdout.replace(ANSI, ""), stderr: stderr.replace(ANSI, "") };
  } finally {
    outSpy.mockRestore();
    errSpy.mockRestore();
    if (stdinDescriptor !== undefined) {
      Object.defineProperty(process, "stdin", stdinDescriptor);
    }
  }
}
