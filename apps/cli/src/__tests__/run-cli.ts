// Drives the REAL program object (same assembly the bin runs) with injected
// deps and captured output, returning the exit code as a value.

import { Readable } from "node:stream";
import { vi } from "vitest";
import type { CliDeps } from "../context";
import { runCli } from "../program";

export interface CliRunResult {
  code: number;
  /** Everything the command wrote to stdout (console.log + raw writes). */
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
  const logSpy = vi.spyOn(console, "log").mockImplementation((...parts: unknown[]) => {
    stdout += `${parts.map((part) => String(part)).join(" ")}\n`;
  });
  const errorSpy = vi.spyOn(console, "error").mockImplementation((...parts: unknown[]) => {
    stderr += `${parts.map((part) => String(part)).join(" ")}\n`;
  });
  // Raw writes (vault read's byte-exact output, commander's own help).
  const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    stdout += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
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
    return { code, stdout, stderr };
  } finally {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    writeSpy.mockRestore();
    if (stdinDescriptor !== undefined) {
      Object.defineProperty(process, "stdin", stdinDescriptor);
    }
  }
}
