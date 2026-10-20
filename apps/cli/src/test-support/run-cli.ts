import { Readable } from "node:stream";
import { vi } from "vitest";
import { CliExitError } from "../cli-error";
import type { CliDeps } from "../context";
import type { OpenExternalUrl } from "../server/browser-opener";
import { runCli } from "../program";
import { resolveServer } from "../server-discovery";
import { DATA_DIR_ENV_VAR } from "../server/config";

// consola colours its decoration only on a TTY, so the same command emits different bytes under a terminal and a pipe.
// built rather than a literal: an escape byte in a regex literal trips no-control-regex and is invisible in a diff.
const ANSI = new RegExp(`${String.fromCodePoint(0x1b)}\\[[0-9;]*m`, "gu");

export interface CliRunResult {
  code: number;
  stdout: string;
  stderr: string;
}

// where a leaf finds its server. `dataDir` is the binary's own way: that data dir's server.json,
// read and judged as every verb reads it, naming the port and the bearer, and refused unless its
// version is `cliVersion`. `baseUrl` null is a data dir with no server.json, so resolving it
// throws before anything is dialed; a string is a booted server's address with its bearer.
type RunTarget =
  | { dataDir: string; cliVersion: string }
  | { baseUrl: null }
  | { baseUrl: string; token: string };

// what a run hands the leaf beside its argv
export interface RunOptions {
  env?: Record<string, string>;
  homeDir?: string;
  openExternalUrl?: OpenExternalUrl;
  // "terminal" is an interactive stdin that carries nothing.
  stdin?: Uint8Array | "terminal";
}

export type RunArgs = RunTarget & RunOptions & { argv: string[] };

const fakeStdin = (stdin: Uint8Array | "terminal"): Readable =>
  stdin === "terminal"
    ? Object.assign(Readable.from([]), { isTTY: true })
    : Readable.from([Buffer.from(stdin)]);

export const runCliForTest = async (args: RunArgs): Promise<CliRunResult> => {
  const target: RunTarget = args;
  const deps: CliDeps = {
    env: { ...args.env },
    homeDir: args.homeDir,
    openExternalUrl: args.openExternalUrl ?? (async () => false),
    resolveServer: () => {
      if ("dataDir" in target) {
        // the env pins the data dir, so the checkout derives nothing here
        return resolveServer({
          checkoutPath: target.dataDir,
          cliVersion: target.cliVersion,
          env: { [DATA_DIR_ENV_VAR]: target.dataDir },
        });
      }
      if (target.baseUrl === null) {
        throw new CliExitError("No inteligir server is running (test)", {
          code: "SERVER_UNREACHABLE",
        });
      }
      return {
        baseUrl: target.baseUrl,
        dataDir: "/test/data",
        token: target.token,
        vaultDir: "/test/vault",
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
