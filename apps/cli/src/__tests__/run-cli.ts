import { Readable } from "node:stream";
import { vi } from "vitest";
import type { CliDeps } from "../context";
import { FIXTURE_SERVER_TOKEN } from "./fixture-server";
import { runCli } from "../program";

// consola colours its decoration only on a TTY, so the same command emits different bytes under a terminal and a pipe.
// built rather than a literal: an escape byte in a regex literal trips no-control-regex and is invisible in a diff.
const ANSI = new RegExp(`${String.fromCodePoint(0x1b)}\\[[0-9;]*m`, "gu");

export interface CliRunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface RunArgs {
  argv: string[];
  baseUrl: string;
  env?: Record<string, string>;
  homeDir?: string;
  stdin?: Uint8Array;
}

export async function runCliForTest(args: RunArgs): Promise<CliRunResult> {
  const deps: CliDeps = {
    env: { ...args.env },
    homeDir: args.homeDir,
    resolveServer: () => ({
      baseUrl: args.baseUrl,
      token: FIXTURE_SERVER_TOKEN,
      dataDir: "/fixture/data",
      vaultDir: "/fixture/vault",
    }),
  };
  let stdout = "";
  let stderr = "";
  // spied on the stream, not console: consola writes to the stream object it was constructed with.
  const outSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    stdout += chunk instanceof Uint8Array ? new TextDecoder().decode(chunk) : chunk;
    return true;
  });
  const errSpy = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    stderr += chunk instanceof Uint8Array ? new TextDecoder().decode(chunk) : chunk;
    return true;
  });
  // process.stdin is a getter, so it is swapped by descriptor rather than spied.
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
