import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { describe, expect, it, onTestFinished } from "vitest";
import { boundAddressSchema } from "./bound-address";
import { makeTempDir } from "./temp-dir";
import { writeServerFile } from "../server-file";
import { assertNoLiveServer } from "../serve";

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

const rowFor = (dataDir: string, port: number, pid: number): void => {
  writeServerFile(dataDir, { pid, port, token: "probe-token", vaultDir: `${dataDir}/vault` });
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
