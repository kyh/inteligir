// Drives the REAL program object (same assembly the bin runs) with injected
// deps and captured output, returning the exit code as a value.

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
}

export async function runCliForTest(args: RunArgs): Promise<CliRunResult> {
  const deps: CliDeps = {
    env: { INTELIGIR_SERVER_URL: args.baseUrl, ...args.env },
    resolveServer: async () => args.baseUrl,
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
  try {
    const code = await runCli(["node", "inteligir", ...args.argv], deps);
    return { code, stdout, stderr };
  } finally {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    writeSpy.mockRestore();
  }
}
