// the one way this server runs a vendor's own binary. the bundled binary alone, because a vendor CLI
// on PATH is an install the app neither ships nor pins; the data dir as cwd, because a vendor reads
// project config from its cwd and the vault is synced content; the harness's envOmit dropped, as
// for its adapter; and a deadline that kills the whole process group, since a vendor binary may
// start helpers that would outlive it.

import { spawn } from "node:child_process";
import type { HarnessDefinition, VendorExit } from "@repo/agent-runtime/acp/harness-registry";
import { messageOf } from "../error-message";

export type VendorRun =
  | ({ kind: "exited" } & VendorExit)
  | { kind: "timed-out" }
  | { kind: "missing" }
  | { kind: "failed"; detail: string };

export interface VendorProcessContext {
  env: NodeJS.ProcessEnv;
  cwd: string;
}

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
  timeoutMs: number,
): Promise<VendorRun> => {
  const executable = harness.vendorExecutable(context.env);
  if (executable === null) {
    return { kind: "missing" };
  }
  // detached: the child leads a process group of its own, which the deadline kills whole.
  const child = spawn(executable, args, {
    cwd: context.cwd,
    detached: true,
    env: vendorEnv(harness, context.env),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf-8").on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.setEncoding("utf-8").on("data", (chunk: string) => {
    stderr += chunk;
  });
  const closed = Promise.withResolvers<{ code: number | null; signal: NodeJS.Signals | null }>();
  child.once("error", closed.reject);
  // close, not exit: the pipes have drained, so the output is whole.
  child.once("close", (code, signal) => {
    closed.resolve({ code, signal });
  });
  let timedOut = false;
  const deadline = setTimeout(() => {
    timedOut = true;
    killGroup(child.pid);
  }, timeoutMs);
  try {
    const { code, signal } = await closed.promise;
    if (code !== null) {
      return { code, kind: "exited", stderr, stdout };
    }
    return timedOut
      ? { kind: "timed-out" }
      : { detail: `${harness.displayName} stopped on ${String(signal)}`, kind: "failed" };
  } catch (error) {
    return { detail: messageOf(error), kind: "failed" };
  } finally {
    clearTimeout(deadline);
  }
};
