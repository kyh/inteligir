// Process-group lifecycle for every long-lived child the harness spawns (app
// instances, the cloud dev Worker): one registry the runner's signal handlers
// sweep, and one TERM→KILL stop ladder verified by ESRCH — two spellings of
// "kill the tree" is how one of them leaks a watcher child.

import { setTimeout as delay } from "node:timers/promises";

const STOP_SIGTERM_GRACE_MS = 5_000;
const STOP_SIGKILL_GRACE_MS = 2_000;
const KILL_POLL_INTERVAL_MS = 100;

/**
 * Every process group spawned and not yet verified dead — module scope on
 * purpose: this is a single-process CLI, and the runner's signal handlers
 * need one place that names every group to kill.
 */
const liveGroups = new Set<number>();

export function trackLiveGroup(pgid: number): void {
  liveGroups.add(pgid);
}

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
export async function stopProcessGroup(pgid: number, name: string): Promise<void> {
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
