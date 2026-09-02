import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { reserveFreePorts } from "./ports";

const STOP_SIGTERM_GRACE_MS = 5_000;
const STOP_SIGKILL_GRACE_MS = 2_000;
const KILL_POLL_INTERVAL_MS = 100;
// bound on losing the reserve→bind race to another process.
const BOOT_PORT_ATTEMPTS = 3;

export interface TrackedProcess {
  name: string;
  outputTail(lines?: number): string;
  // throws if the group survives SIGKILL; the caller must then keep the scratch.
  stop(): Promise<void>;
}

export interface SupervisedChild extends TrackedProcess {
  exited(): boolean;
}

// module scope: the runner's signal handlers need one place naming every group to kill.
const liveGroups = new Set<number>();

export function killAllLiveGroups(signal: NodeJS.Signals): void {
  for (const pgid of liveGroups) {
    try {
      process.kill(-pgid, signal);
    } catch {
      // group already gone.
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

// signals the group, leader dead or not: a forked child outlives a crashed leader.
async function stopProcessGroup(pgid: number, name: string): Promise<void> {
  try {
    process.kill(-pgid, "SIGTERM");
  } catch {
    // whole group already gone.
  }
  if (await pollGroupGone(pgid, STOP_SIGTERM_GRACE_MS)) {
    liveGroups.delete(pgid);
    return;
  }
  try {
    process.kill(-pgid, "SIGKILL");
  } catch {
    // gone between polls.
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
  name: string;
  file: string;
  argv: readonly string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
}

// its own process group, so stop() kills the tree: the server's watcher and wrangler's workerd
// would otherwise outlive it.
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

// node says EADDRINUSE; workerd says it in prose.
function looksLikePortLost(tail: string): boolean {
  return tail.includes("EADDRINUSE") || tail.includes("Address already in use");
}

export interface BootWithPortsArgs<T extends TrackedProcess> {
  label: string;
  portCount: number;
  deadlineMs: number;
  pollIntervalMs: number;
  onLog: (line: string) => void;
  // must register the handle for teardown before returning, so a child that dies during the ready
  // wait is still owned.
  spawn: (ports: readonly number[]) => { handle: T; child: SupervisedChild };
  // must not throw.
  ready: (handle: T) => Promise<boolean>;
}

// retries with fresh ports when the child lost the reserve→bind race (reserveFreePorts releases
// before returning).
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
