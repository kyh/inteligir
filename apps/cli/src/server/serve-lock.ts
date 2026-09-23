// server.json is published only after compose and listen, so two boots started together both find
// no row and both open one db. the lock is what they race for instead: a file holding the owner's
// pid, created O_EXCL before anything is composed and removed only after the db has closed.

import { closeSync, fstatSync, openSync, readFileSync, rmSync, writeSync } from "node:fs";
import path from "node:path";
import { errnoCode } from "./errno";

export const serveLockPath = (dataDir: string): string => path.join(dataDir, "serve.lock");

// EPERM is a live process this user may not signal; ESRCH is gone.
export const processAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return errnoCode(error) === "EPERM";
  }
};

type ServeLockClaim =
  | { kind: "acquired"; release: () => void }
  // null when the holder's pid could not be read.
  | { kind: "held"; pid: number | null };

// the inode names the file itself, so a lock replaced since it was judged is told from the one that was.
interface LockHolder {
  ino: bigint;
  pid: number | null;
}

const PID_PATTERN = /^[1-9]\d*$/u;

const readHolder = (lockPath: string): LockHolder | null => {
  let fd: number;
  try {
    fd = openSync(lockPath, "r");
  } catch (error) {
    if (errnoCode(error) === "ENOENT") {
      return null;
    }
    throw error;
  }
  try {
    const text = readFileSync(fd, "utf-8").trim();
    return {
      ino: fstatSync(fd, { bigint: true }).ino,
      pid: PID_PATTERN.test(text) ? Number(text) : null,
    };
  } finally {
    closeSync(fd);
  }
};

const tryCreate = (lockPath: string): boolean => {
  let fd: number;
  try {
    fd = openSync(lockPath, "wx", 0o600);
  } catch (error) {
    if (errnoCode(error) === "EEXIST") {
      return false;
    }
    throw error;
  }
  try {
    writeSync(fd, `${String(process.pid)}\n`);
  } finally {
    closeSync(fd);
  }
  return true;
};

// only our own: a lock another boot took after judging ours stale is that boot's to remove.
const releaseLock = (lockPath: string): void => {
  if (readHolder(lockPath)?.pid === process.pid) {
    rmSync(lockPath, { force: true });
  }
};

// a second loss is a concurrent boot that broke the same stale lock first.
const ATTEMPTS = 2;

export const acquireServeLock = async (
  dataDir: string,
  // the caller's verdict: a pid can outlive its server under an unrelated process.
  holderIsLive: (pid: number) => Promise<boolean>,
): Promise<ServeLockClaim> => {
  const lockPath = serveLockPath(dataDir);
  let holder: LockHolder | null = null;
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    if (tryCreate(lockPath)) {
      return {
        kind: "acquired",
        release: () => {
          releaseLock(lockPath);
        },
      };
    }
    holder = readHolder(lockPath);
    if (holder === null) {
      continue;
    }
    // no pid yet is a holder between its create and its write, never a stale one.
    if (holder.pid === null || (await holderIsLive(holder.pid))) {
      return { kind: "held", pid: holder.pid };
    }
    // the verdict took time; remove only the file it was about.
    const current = readHolder(lockPath);
    if (current?.ino === holder.ino && current.pid === holder.pid) {
      rmSync(lockPath, { force: true });
    }
  }
  return { kind: "held", pid: holder?.pid ?? null };
};
