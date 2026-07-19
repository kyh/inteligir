import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { acquireHostLock, reassertHostLock, releaseHostLock } from "../storage/host-lock";

let dir: string;
let lockPath: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "host-lock-"));
  lockPath = path.join(dir, "host.lock");
});

afterEach(() => {
  releaseHostLock();
  fs.rmSync(dir, { recursive: true, force: true });
});

/** A pid guaranteed dead: a child that already exited. */
function deadPid(): number {
  const child = spawnSync("true");
  if (typeof child.pid !== "number") throw new Error("failed to spawn probe child");
  return child.pid;
}

describe("host lock", () => {
  it("acquires by writing our pid", () => {
    acquireHostLock(lockPath);
    expect(fs.readFileSync(lockPath, "utf8").trim()).toBe(String(process.pid));
  });

  it("refuses to boot beside a live host", () => {
    // pid 1 (init/launchd) is always alive and never ours — kill(1, 0) is
    // EPERM, which must count as alive.
    fs.writeFileSync(lockPath, "1\n");
    expect(() => acquireHostLock(lockPath)).toThrow(/already running/);
  });

  it("reclaims a stale lock (dead pid) and an unparseable one", () => {
    fs.writeFileSync(lockPath, `${deadPid()}\n`);
    acquireHostLock(lockPath);
    expect(fs.readFileSync(lockPath, "utf8").trim()).toBe(String(process.pid));

    releaseHostLock();
    fs.writeFileSync(lockPath, "not-a-pid\n");
    acquireHostLock(lockPath);
    expect(fs.readFileSync(lockPath, "utf8").trim()).toBe(String(process.pid));
  });

  it("re-acquiring our own lock is fine (idempotent within the process)", () => {
    acquireHostLock(lockPath);
    expect(() => acquireHostLock(lockPath)).not.toThrow();
  });

  it("reassert re-writes the pidfile after something wiped it (logout rm -rf)", () => {
    acquireHostLock(lockPath);
    fs.rmSync(lockPath);
    reassertHostLock();
    expect(fs.readFileSync(lockPath, "utf8").trim()).toBe(String(process.pid));
  });

  it("release removes only a lock we still own", () => {
    acquireHostLock(lockPath);
    releaseHostLock();
    expect(fs.existsSync(lockPath)).toBe(false);

    // A newer process re-took the lock while we shut down: leave it alone.
    acquireHostLock(lockPath);
    fs.writeFileSync(lockPath, "1\n");
    releaseHostLock();
    expect(fs.readFileSync(lockPath, "utf8").trim()).toBe("1");
  });
});
