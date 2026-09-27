// the one way this server runs a vendor's own binary. the bundled binary alone, because a vendor CLI
// on PATH is an install the app neither ships nor pins; the data dir as cwd, because a vendor reads
// project config from its cwd and the vault is synced content; the harness's envOmit dropped, as
// for its adapter; and a stop, a deadline or the caller's cancel, that kills the whole process
// group, since a vendor binary may start helpers that would outlive it.

import { spawn } from "node:child_process";
import type { Readable } from "node:stream";
import { stripVTControlCharacters } from "node:util";
import { harnessHostEnv } from "@repo/agent-runtime/acp/harness-registry";
import type { HarnessDefinition, VendorExit } from "@repo/agent-runtime/acp/harness-registry";
import { messageOf } from "../error-message";

export type VendorRun =
  | ({ kind: "exited" } & VendorExit)
  // the caller's signal ended it; the caller knows whether that was its deadline or its cancel.
  | { kind: "stopped" }
  | { kind: "missing" }
  | { kind: "failed"; detail: string };

export interface VendorProcessContext {
  env: NodeJS.ProcessEnv;
  cwd: string;
}

export type VendorRunOptions = {
  signal: AbortSignal;
  // each stdout chunk as it arrives, for a run whose answer a caller needs before it exits.
  onStdout?: (chunk: string) => void;
} &
  // piped to the vendor's stdin while it runs; absent, the vendor reads end of input at once.
  (
    | { stdin?: Readable; pty?: never }
    // a terminal of its own, for a vendor command that refuses to run without one; its stdout and
    // stderr arrive together, as stdout.
    | { pty: true; stdin?: never }
  );

// macOS's script(1) gives the vendor a pty and exits with its status; util-linux's takes the
// command as one shell string, which this server never builds, and the app ships on macOS alone.
const PTY_WRAPPER = "/usr/bin/script";

const ptyArgv = (executable: string, args: readonly string[]): readonly string[] | null =>
  process.platform === "darwin" ? ["-q", "/dev/null", executable, ...args] : null;

const STDERR_TAIL_LINES = 5;

export const missingRuntimeDetail = (harness: HarnessDefinition): string =>
  `This copy of inteligir is missing its ${harness.displayName} runtime — reinstall it`;

// a pty hands back the vendor's colours and carriage returns with its words.
const plainText = (output: string): string => stripVTControlCharacters(output).replaceAll("\r", "");

const lines = (text: string): string[] =>
  plainText(text)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");

// the vendor's own words: its stderr's last lines, else the last line it printed, which is where a
// pty puts both.
const exitDetail = (harness: HarnessDefinition, doing: string, exit: VendorExit): string => {
  const stderr = lines(exit.stderr).slice(-STDERR_TAIL_LINES);
  const said = stderr.length > 0 ? stderr : lines(exit.stdout).slice(-1);
  return said.length === 0
    ? `${harness.displayName} stopped ${doing} (exit ${String(exit.code)})`
    : `${harness.displayName} could not finish ${doing}: ${said.join("\n")}`;
};

export const succeeded = (
  run: VendorRun,
): run is Extract<VendorRun, { kind: "exited" }> & { code: 0 } =>
  run.kind === "exited" && run.code === 0;

// what a run that did not do its work says of it; exit 0 is its caller's to read first. A stop is
// read as the deadline the caller's signal carried, `timeoutMs`.
export const failureOf = (
  harness: HarnessDefinition,
  doing: string,
  run: VendorRun,
  timeoutMs: number,
): string => {
  switch (run.kind) {
    case "exited": {
      return exitDetail(harness, doing, run);
    }
    case "stopped": {
      return `${harness.displayName} did not finish ${doing} within ${String(timeoutMs / 1000)}s`;
    }
    case "missing": {
      return missingRuntimeDetail(harness);
    }
    case "failed": {
      return run.detail;
    }
    // no default
  }
};

interface PrintedUrlWatcher {
  onStdout: (chunk: string) => void;
  authUrl: () => string | null;
}

// the address a vendor prints for a browser that did not open, taken only once a space or line
// end closes it, so a chunk boundary never exposes half of one. Each caller names the schemes it
// takes.
export const printedUrlWatcher = (pattern: RegExp): PrintedUrlWatcher => {
  let printed = "";
  let authUrl: string | null = null;
  return {
    authUrl: () => authUrl,
    onStdout: (chunk) => {
      if (authUrl !== null) {
        return;
      }
      printed += chunk;
      const url = pattern.exec(plainText(printed))?.[0];
      if (url !== undefined && URL.canParse(url)) {
        authUrl = url;
      }
    },
  };
};

const killGroup = (pid: number | undefined): void => {
  if (pid === undefined) {
    return;
  }
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    // the group is already gone
  }
};

export const runVendor = async (
  harness: HarnessDefinition,
  args: readonly string[],
  context: VendorProcessContext,
  options: VendorRunOptions,
): Promise<VendorRun> => {
  const { signal } = options;
  const executable = harness.vendorExecutable(context.env);
  if (executable === null) {
    return { kind: "missing" };
  }
  if (signal.aborted) {
    return { kind: "stopped" };
  }
  const wrapped = options.pty === true ? ptyArgv(executable, args) : null;
  if (options.pty === true && wrapped === null) {
    return {
      detail: `${harness.displayName} needs a terminal for this, which inteligir gives it only on macOS`,
      kind: "failed",
    };
  }
  // detached: the child leads a process group of its own, which a stop kills whole. under the pty
  // wrapper the vendor leads the pty's session instead, and the wrapper's death hangs it up.
  const spawnOptions = {
    cwd: context.cwd,
    detached: true,
    env: harnessHostEnv(harness, context.env),
  };
  // the wrapper types its own stdin into the terminal. /dev/null, never a pipe: node's is a socket,
  // which script(1) refuses; its end of input is typed as one ^D, which the vendor reads past.
  const child =
    wrapped === null
      ? spawn(executable, args, { ...spawnOptions, stdio: ["pipe", "pipe", "pipe"] })
      : spawn(PTY_WRAPPER, wrapped, { ...spawnOptions, stdio: ["ignore", "pipe", "pipe"] });
  if (child.stdin !== null) {
    // a vendor that exits with input still unread closes the pipe under the write, and an unheard
    // EPIPE would take the server down with it; the exit is the answer that matters.
    child.stdin.on("error", () => {
      /* empty */
    });
    if (options.stdin === undefined) {
      child.stdin.end();
    } else {
      options.stdin.pipe(child.stdin);
    }
  }
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf-8").on("data", (chunk: string) => {
    stdout += chunk;
    options.onStdout?.(chunk);
  });
  child.stderr.setEncoding("utf-8").on("data", (chunk: string) => {
    stderr += chunk;
  });
  const closed = Promise.withResolvers<{ code: number | null; signal: NodeJS.Signals | null }>();
  child.once("error", closed.reject);
  // close, not exit: the pipes have drained, so the output is whole.
  child.once("close", (code, exitSignal) => {
    closed.resolve({ code, signal: exitSignal });
  });
  const stop = (): void => {
    killGroup(child.pid);
  };
  signal.addEventListener("abort", stop, { once: true });
  try {
    const exit = await closed.promise;
    if (exit.code !== null) {
      return { code: exit.code, kind: "exited", stderr, stdout };
    }
    return signal.aborted
      ? { kind: "stopped" }
      : { detail: `${harness.displayName} stopped on ${String(exit.signal)}`, kind: "failed" };
  } catch (error) {
    return { detail: messageOf(error), kind: "failed" };
  } finally {
    signal.removeEventListener("abort", stop);
    if (child.stdin !== null) {
      options.stdin?.unpipe(child.stdin);
    }
  }
};
