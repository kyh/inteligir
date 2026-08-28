// Every long-lived child the harness spawns — an app instance, the cloud dev
// Worker — supervised the same way: one process-group registry the runner's
// signal handlers sweep, one TERM→KILL ladder verified by ESRCH, one output
// ring for failure transcripts, and one reserve→spawn→ready→retry boot loop.
//
// ONE spelling of each, because two are how one of them leaks a watcher child,
// or reports a lost port as a crash, or drops the log that explains a failure.
// What a caller supplies is only what makes its child different: the argv, the
// env, how to tell it is ready, and what handle the scenario wants back.

import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { reserveFreePorts } from "./ports";

const STOP_SIGTERM_GRACE_MS = 5_000;
const STOP_SIGKILL_GRACE_MS = 2_000;
const KILL_POLL_INTERVAL_MS = 100;
/** Bound on losing the reserve→bind race to another process on the machine. */
const BOOT_PORT_ATTEMPTS = 3;

/**
 * What the runner's teardown and failure transcript need from a child: stopped
 * in reverse launch order, counted in `teardownClean` (a group surviving
 * SIGKILL keeps the scratch), and its output printed when a scenario fails.
 */
export interface TrackedProcess {
  name: string;
  /** The child's interleaved stdout+stderr tail, for failure transcripts. */
  outputTail(lines?: number): string;
  /** Resolves once the WHOLE process group is verified gone (ESRCH); throws
   *  if the group survives SIGKILL — the caller must then keep the scratch. */
  stop(): Promise<void>;
}

/** A tracked child plus the liveness flag its own exit handlers set. */
export interface SupervisedChild extends TrackedProcess {
  exited(): boolean;
}

/**
 * Every process group spawned and not yet verified dead — module scope on
 * purpose: this is a single-process CLI, and the runner's signal handlers
 * need one place that names every group to kill.
 */
const liveGroups = new Set<number>();

/** For the runner's SIGINT/SIGTERM handlers; synchronous, best-effort. */
export function killAllLiveGroups(signal: NodeJS.Signals): void {
  for (const pgid of liveGroups) {
    try {
      process.kill(-pgid, signal);
    } catch {
      // Group already gone.
    }
  }
}

function groupAlive(pgid: number): boolean {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch {
    return false;
  }
}

async function pollGroupGone(pgid: number, graceMs: number): Promise<boolean> {
  const deadline = Date.now() + graceMs;
  for (;;) {
    if (!groupAlive(pgid)) {
      return true;
    }
    if (Date.now() > deadline) {
      return false;
    }
    await delay(KILL_POLL_INTERVAL_MS);
  }
}

/**
 * SIGTERM the GROUP, leader dead or not — a forked child outlives a crashed
 * leader — then SIGKILL, each with its own grace; resolves once the whole
 * group is verified gone (ESRCH) and throws if it survives SIGKILL. (A
 * recycled pgid is theoretically reachable here; the window between leader
 * exit and the signal is too small to matter on a test box.)
 */
async function stopProcessGroup(pgid: number, name: string): Promise<void> {
  try {
    process.kill(-pgid, "SIGTERM");
  } catch {
    // Whole group already gone.
  }
  if (await pollGroupGone(pgid, STOP_SIGTERM_GRACE_MS)) {
    liveGroups.delete(pgid);
    return;
  }
  try {
    process.kill(-pgid, "SIGKILL");
  } catch {
    // Gone between polls.
  }
  if (await pollGroupGone(pgid, STOP_SIGKILL_GRACE_MS)) {
    liveGroups.delete(pgid);
    return;
  }
  throw new Error(
    `${name}: process group ${pgid} survived SIGKILL — refusing to treat it as torn down`,
  );
}

export interface SpawnSupervisedArgs {
  /** Short label for transcript lines ("a", "b", "cloud-worker"). */
  name: string;
  file: string;
  argv: readonly string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
}

/** Spawn a child in ITS OWN process group — so stop() kills the whole tree,
 *  and a forked grandchild (the server's watcher, wrangler's workerd) cannot
 *  outlive it — with its output ringed for the failure transcript. */
export function spawnSupervised(args: SpawnSupervisedArgs): SupervisedChild {
  const child = spawn(args.file, [...args.argv], {
    cwd: args.cwd,
    detached: true,
    env: args.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const pid = child.pid;
  if (pid !== undefined) {
    liveGroups.add(pid);
  }

  const outputLines: string[] = [];
  function consume(stream: NodeJS.ReadableStream, label: string): void {
    let buffered = "";
    stream.setEncoding("utf8");
    stream.on("data", (chunk: string) => {
      buffered += chunk;
      const lines = buffered.split("\n");
      buffered = lines.pop() ?? "";
      for (const line of lines) {
        if (line.length > 0) {
          outputLines.push(`[${label}] ${line}`);
        }
      }
    });
  }
  const stdout = child.stdout;
  const stderr = child.stderr;
  if (stdout !== null) {
    consume(stdout, args.name);
  }
  if (stderr !== null) {
    consume(stderr, `${args.name}!`);
  }

  let exited = false;
  child.once("exit", () => {
    exited = true;
  });
  child.once("error", (error) => {
    outputLines.push(`[${args.name}!] spawn error: ${error.message}`);
    exited = true;
  });

  let stopPromise: Promise<void> | null = null;
  return {
    name: args.name,
    outputTail: (lines = 40) => outputLines.slice(-lines).join("\n"),
    stop() {
      stopPromise ??= pid === undefined ? Promise.resolve() : stopProcessGroup(pid, args.name);
      return stopPromise;
    },
    exited: () => exited,
  };
}

/** Whether a dead child's output says it lost the reserve→bind race. Node
 *  says `EADDRINUSE`; workerd says it in prose — one matcher, so neither
 *  spelling reads as a crash. */
function looksLikePortLost(tail: string): boolean {
  return tail.includes("EADDRINUSE") || tail.includes("Address already in use");
}

export interface BootWithPortsArgs<T extends TrackedProcess> {
  /** Named in every failure message; also the transcript label. */
  label: string;
  /** How many free loopback ports this child needs reserved. */
  portCount: number;
  /** How long the child gets to answer `ready` before the boot fails. */
  deadlineMs: number;
  pollIntervalMs: number;
  onLog: (line: string) => void;
  /**
   * Spawn one attempt on the reserved ports and hand back the caller's own
   * handle. Register it for teardown HERE, before the ready wait, so a child
   * that dies early is still owned by whoever tears down.
   */
  spawn: (ports: readonly number[]) => { handle: T; child: SupervisedChild };
  /** True once the child is serving. Must not throw. */
  ready: (handle: T) => Promise<boolean>;
}

/**
 * Reserve ports, spawn, and wait until `ready` — retrying with FRESH ports
 * when the child died holding a port someone else took between the
 * reservation and the bind (`reserveFreePorts` releases before returning, so
 * that race is real and bounded rather than fatal).
 */
export async function bootWithPorts<T extends TrackedProcess>(
  args: BootWithPortsArgs<T>,
): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    const ports = await reserveFreePorts(args.portCount);
    if (ports.length !== args.portCount) {
      throw new Error("port reservation returned nothing");
    }
    const { handle, child } = args.spawn(ports);

    const deadline = Date.now() + args.deadlineMs;
    let outcome: "ready" | "port-lost" | null = null;
    for (; outcome === null;) {
      if (child.exited()) {
        const tail = child.outputTail();
        await child.stop();
        if (!looksLikePortLost(tail)) {
          throw new Error(`${args.label} exited before becoming ready\n${tail}`);
        }
        outcome = "port-lost";
      } else if (await args.ready(handle)) {
        outcome = "ready";
      } else if (Date.now() > deadline) {
        const tail = child.outputTail();
        await child.stop();
        throw new Error(`${args.label} did not become ready within ${args.deadlineMs}ms\n${tail}`);
      } else {
        await delay(args.pollIntervalMs);
      }
    }
    if (outcome === "ready") {
      return handle;
    }
    if (attempt >= BOOT_PORT_ATTEMPTS) {
      throw new Error(
        `${args.label} lost its reserved port ${String(BOOT_PORT_ATTEMPTS)} times in a row`,
      );
    }
    args.onLog(`${args.label} lost its reserved port at bind; retrying with a fresh one`);
  }
}
