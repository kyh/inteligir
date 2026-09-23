import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { describe, expect, it, onTestFinished } from "vitest";
import { boundAddressSchema } from "./bound-address";
import { makeTempDir } from "./temp-dir";
import { writeServerFile } from "../server-file";
import { assertNoLiveServer, claimDataDir } from "../serve";
import { acquireServeLock, processAlive, serveLockPath } from "../serve-lock";
import type { ShutdownStep } from "../shutdown";

const closeWedged = async (server: Server): Promise<void> => {
  server.closeAllConnections();
  server.close();
  await once(server, "close");
};

const wedgedListener = async (): Promise<number> => {
  const server = createServer(() => {
    // no response on purpose: the connection stays open.
  });
  onTestFinished(async () => {
    await closeWedged(server);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return boundAddressSchema.parse(server.address()).port;
};

const freePort = async (): Promise<number> => {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = boundAddressSchema.parse(server.address());
  server.close();
  await once(server, "close");
  return port;
};

const reapedPid = async (): Promise<number> => {
  const child = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
  const { pid } = child;
  await once(child, "exit");
  if (pid === undefined) {
    throw new Error("the probe child was never spawned");
  }
  return pid;
};

// alive for the test and unrelated to any server: what a crashed server's pid becomes once reused.
const liveUnrelatedPid = async (): Promise<number> => {
  const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60_000)"], {
    stdio: "ignore",
  });
  onTestFinished(() => {
    child.kill();
  });
  await once(child, "spawn");
  if (child.pid === undefined) {
    throw new Error("the stand-in child was never spawned");
  }
  return child.pid;
};

const rowFor = (dataDir: string, port: number, pid: number): void => {
  writeServerFile(dataDir, { pid, port, token: "probe-token", vaultDir: `${dataDir}/vault` });
};

const lockFor = (dataDir: string, content: string): void => {
  writeFileSync(serveLockPath(dataDir), content, "utf-8");
};

const lockContent = (dataDir: string): string => readFileSync(serveLockPath(dataDir), "utf-8");

const isAlive = async (pid: number): Promise<boolean> => {
  await Promise.resolve();
  return processAlive(pid);
};

const runTeardown = async (teardown: readonly ShutdownStep[]): Promise<void> => {
  for (const step of teardown) {
    await step.run();
  }
};

describe("assertNoLiveServer", () => {
  it("refuses a boot whose owner is alive but not answering, naming the pid", async () => {
    const dataDir = makeTempDir("inteligir-guard-wedged-");
    rowFor(dataDir, await wedgedListener(), process.pid);

    await expect(assertNoLiveServer(dataDir)).rejects.toThrow(
      new RegExp(`pid ${String(process.pid)}`, "u"),
    );
  });

  it("proceeds against a stale row whose owner is gone", async () => {
    const dataDir = makeTempDir("inteligir-guard-stale-");
    rowFor(dataDir, await wedgedListener(), await reapedPid());

    await expect(assertNoLiveServer(dataDir)).resolves.toBeUndefined();
  });

  it("proceeds when the connection is refused, whatever the pid says", async () => {
    const dataDir = makeTempDir("inteligir-guard-refused-");
    rowFor(dataDir, await freePort(), process.pid);

    await expect(assertNoLiveServer(dataDir)).resolves.toBeUndefined();
  });
});

describe("acquireServeLock", () => {
  it("takes a free data dir under this pid, and its release removes the lock", async () => {
    const dataDir = makeTempDir("inteligir-lock-free-");
    const claim = await acquireServeLock(dataDir, isAlive);
    expect(claim.kind).toBe("acquired");
    expect(lockContent(dataDir).trim()).toBe(String(process.pid));
    if (claim.kind === "acquired") {
      claim.release();
    }
    expect(existsSync(serveLockPath(dataDir))).toBe(false);
  });

  it("refuses while the holder is alive, naming its pid", async () => {
    const dataDir = makeTempDir("inteligir-lock-held-");
    const holder = await liveUnrelatedPid();
    lockFor(dataDir, `${String(holder)}\n`);

    await expect(acquireServeLock(dataDir, isAlive)).resolves.toEqual({
      kind: "held",
      pid: holder,
    });
    expect(lockContent(dataDir).trim()).toBe(String(holder));
  });

  it("breaks a lock whose holder is gone, and takes it", async () => {
    const dataDir = makeTempDir("inteligir-lock-stale-");
    lockFor(dataDir, `${String(await reapedPid())}\n`);

    await expect(acquireServeLock(dataDir, isAlive)).resolves.toMatchObject({ kind: "acquired" });
    expect(lockContent(dataDir).trim()).toBe(String(process.pid));
  });

  it("counts a holder that has not written its pid yet as live, never as stale", async () => {
    const dataDir = makeTempDir("inteligir-lock-empty-");
    lockFor(dataDir, "");

    await expect(acquireServeLock(dataDir, isAlive)).resolves.toEqual({ kind: "held", pid: null });
    expect(existsSync(serveLockPath(dataDir))).toBe(true);
  });

  it("leaves a lock on release that another boot has taken since", async () => {
    const dataDir = makeTempDir("inteligir-lock-taken-");
    const claim = await acquireServeLock(dataDir, isAlive);
    const other = await liveUnrelatedPid();
    lockFor(dataDir, `${String(other)}\n`);

    if (claim.kind === "acquired") {
      claim.release();
    }
    expect(lockContent(dataDir).trim()).toBe(String(other));
  });
});

describe("claimDataDir", () => {
  it("lets exactly one of two concurrent boots through to compose", async () => {
    const dataDir = makeTempDir("inteligir-claim-race-");
    let composed = 0;
    const teardowns: ShutdownStep[][] = [];
    const boot = async (): Promise<void> => {
      const teardown: ShutdownStep[] = [];
      teardowns.push(teardown);
      await claimDataDir(dataDir, teardown);
      composed += 1;
    };

    const settled = await Promise.allSettled([boot(), boot()]);

    expect(
      composed,
      "server.json is published only after listen, so the lock must be what the second boot loses to",
    ).toBe(1);
    expect(settled.filter((result) => result.status === "rejected")).toHaveLength(1);
    await Promise.all(teardowns.map(runTeardown));
  });

  it("refuses while another boot holds the data dir, before it has published a row", async () => {
    const dataDir = makeTempDir("inteligir-claim-booting-");
    const holder = await liveUnrelatedPid();
    lockFor(dataDir, `${String(holder)}\n`);

    await expect(claimDataDir(dataDir, [])).rejects.toThrow(
      new RegExp(`pid ${String(holder)}\\) already holds`, "u"),
    );
  });

  it("breaks a lock a crash left once its pid answers to something else", async () => {
    const dataDir = makeTempDir("inteligir-claim-reused-");
    const reused = await liveUnrelatedPid();
    lockFor(dataDir, `${String(reused)}\n`);
    rowFor(dataDir, await freePort(), reused);

    const teardown: ShutdownStep[] = [];
    await claimDataDir(dataDir, teardown);
    expect(lockContent(dataDir).trim()).toBe(String(process.pid));
    await runTeardown(teardown);
  });

  it("holds the data dir until the teardown's lock step releases it", async () => {
    const dataDir = makeTempDir("inteligir-claim-release-");
    const teardown: ShutdownStep[] = [];
    await claimDataDir(dataDir, teardown);
    expect(teardown.map((step) => step.name)).toEqual(["lock"]);
    expect(existsSync(serveLockPath(dataDir))).toBe(true);

    await runTeardown(teardown);
    expect(existsSync(serveLockPath(dataDir))).toBe(false);
  });
});
