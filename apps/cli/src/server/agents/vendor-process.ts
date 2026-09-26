// the one way this server runs a vendor's own binary. the bundled binary alone, because a vendor CLI
// on PATH is an install the app neither ships nor pins; the data dir as cwd, because a vendor reads
// project config from its cwd and the vault is synced content; the harness's envOmit dropped, as
// for its adapter; and a stop, a deadline or the caller's cancel, that kills the whole process
// group, since a vendor binary may start helpers that would outlive it.

import { spawn } from "node:child_process";
import type { Readable } from "node:stream";
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

const vendorEnv = (harness: HarnessDefinition, env: NodeJS.ProcessEnv): Record<string, string> => {
  const omitted = new Set(harness.envOmit);
  return Object.fromEntries(
    Object.entries(env).flatMap(([key, value]) =>
      value === undefined || omitted.has(key) ? [] : [[key, value]],
    ),
  );
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
  const spawnOptions = { cwd: context.cwd, detached: true, env: vendorEnv(harness, context.env) };
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
