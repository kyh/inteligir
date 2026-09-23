import { Readable } from "node:stream";
import { vi } from "vitest";
import { CliExitError, EXIT_UNREACHABLE } from "../cli-error";
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
  // null is a data dir with no server.json: resolving the server throws before anything is dialed.
  baseUrl: string | null;
  env?: Record<string, string>;
  homeDir?: string;
  // "terminal" is an interactive stdin that carries nothing.
  stdin?: Uint8Array | "terminal";
}

const fakeStdin = (stdin: Uint8Array | "terminal"): Readable =>
  stdin === "terminal"
    ? Object.assign(Readable.from([]), { isTTY: true })
    : Readable.from([Buffer.from(stdin)]);

export const runCliForTest = async (args: RunArgs): Promise<CliRunResult> => {
  const { baseUrl } = args;
  const deps: CliDeps = {
    env: { ...args.env },
    homeDir: args.homeDir,
    resolveServer: () => {
      if (baseUrl === null) {
        throw new CliExitError("No inteligir server is running (fixture)", {
          code: "SERVER_UNREACHABLE",
          exitCode: EXIT_UNREACHABLE,
        });
      }
      return {
        baseUrl,
        dataDir: "/fixture/data",
        token: FIXTURE_SERVER_TOKEN,
        vaultDir: "/fixture/vault",
      };
    },
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
      value: fakeStdin(args.stdin),
    });
  }
  try {
    const code = await runCli(["node", "inteligir", ...args.argv], deps);
    return { code, stderr: stderr.replace(ANSI, ""), stdout: stdout.replace(ANSI, "") };
  } finally {
    outSpy.mockRestore();
    errSpy.mockRestore();
    if (stdinDescriptor !== undefined) {
      Object.defineProperty(process, "stdin", stdinDescriptor);
    }
  }
};
