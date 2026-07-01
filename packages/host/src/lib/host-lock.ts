// ---------------------------------------------------------------------------
// Single-host pidfile lock over ~/.inteligir. Two hosts on one state dir is
// the #1 replatform hazard: they'd resume the same pi session thread, fight
// over the executor daemon's pinned port + server-control manifest, and a
// logout's rm -rf would yank live stores out from under the other process.
// Refuse to boot instead.
// ---------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";

import { inteligirPath } from "./json-store";

const DEFAULT_LOCK_PATH = inteligirPath("host.lock");

let heldLockPath: string | null = null;

function readLockPid(lockPath: string): number | null {
  let raw: string;
  try {
    raw = fs.readFileSync(lockPath, "utf8");
  } catch {
    return null;
  }
  const pid = Number.parseInt(raw.trim(), 10);
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

function pidIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM = exists but not ours — still alive. Anything else (ESRCH) = dead.
    return err instanceof Error && "code" in err && err.code === "EPERM";
  }
}

function writeLock(lockPath: string): void {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  fs.writeFileSync(lockPath, `${process.pid}\n`, { mode: 0o600 });
}

/** Take the lock or throw. A stale lock (dead pid, unparseable file) is
 * silently reclaimed. */
export function acquireHostLock(lockPath: string = DEFAULT_LOCK_PATH): void {
  const existing = readLockPid(lockPath);
  if (existing !== null && existing !== process.pid && pidIsAlive(existing)) {
    throw new Error(
      `Another Inteligir host (pid ${existing}) is already running against ` +
        `${path.dirname(lockPath)}. Two hosts sharing that state directory would corrupt ` +
        `sessions, stores, and the executor daemon — quit the other instance first.`,
    );
  }
  writeLock(lockPath);
  heldLockPath = lockPath;
}

/** Re-write the lock after something wiped ~/.inteligir (logout teardown
 * rm -rf's the dir, taking our own pidfile with it). */
export function reassertHostLock(): void {
  if (heldLockPath) writeLock(heldLockPath);
}

/** Drop the lock on graceful shutdown. Only removes a file we still own —
 * never a newer process's lock. */
export function releaseHostLock(): void {
  if (!heldLockPath) return;
  if (readLockPid(heldLockPath) === process.pid) {
    fs.rmSync(heldLockPath, { force: true });
  }
  heldLockPath = null;
}
