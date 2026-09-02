import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import { describe, expect, it, onTestFinished } from "vitest";
import { boundAddressSchema } from "./bound-address";
import { makeTempDir } from "./temp-dir";
import { writeServerFile } from "../server-file";
import { assertNoLiveServer } from "../serve";

function closeWedged(server: Server): Promise<void> {
  server.closeAllConnections();
  return new Promise<void>((resolve) => server.close(() => resolve()));
}

async function wedgedListener(): Promise<number> {
  const server = createServer(() => {
    // no response on purpose: the connection stays open.
  });
  onTestFinished(() => closeWedged(server));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return boundAddressSchema.parse(server.address()).port;
}

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = boundAddressSchema.parse(server.address());
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

async function reapedPid(): Promise<number> {
  const child = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
  const pid = child.pid;
  await new Promise<void>((resolve) => child.on("exit", () => resolve()));
  if (pid === undefined) {
    throw new Error("the probe child was never spawned");
  }
  return pid;
}

function rowFor(dataDir: string, port: number, pid: number): void {
  writeServerFile(dataDir, { port, token: "probe-token", vaultDir: `${dataDir}/vault`, pid });
}

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
