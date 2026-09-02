// The second-boot guard, over the THREE states a `server.json` row can be in.
// The one that matters is the middle one: better-sqlite3 is synchronous, so an
// owner can be alive, holding the vault, and unable to answer — and a guard
// that reads silence as "nobody there" binds a neighbouring port and overwrites
// the row, which is the two-servers-on-one-vault outcome it exists to prevent.

import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import { describe, expect, it, onTestFinished } from "vitest";
import { boundAddressSchema } from "./bound-address";
import { makeTempDir } from "./temp-dir";
import { writeServerFile } from "../server-file";
import { assertNoLiveServer } from "../serve";

/** Close a listener whose connections were never answered. */
function closeWedged(server: Server): Promise<void> {
  server.closeAllConnections();
  return new Promise<void>((resolve) => server.close(() => resolve()));
}

/** A listener that accepts and never answers — the wedged owner. */
async function wedgedListener(): Promise<number> {
  const server = createServer(() => {
    // Deliberately no response: the connection stays open.
  });
  onTestFinished(() => closeWedged(server));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return boundAddressSchema.parse(server.address()).port;
}

/** A port nothing holds: bound, read, released. */
async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = boundAddressSchema.parse(server.address());
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

/** A pid that has been reaped — what a crashed owner's row names. */
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
    // The row outlives a crash on purpose, and its pid is what says so — with
    // no round trip a port a stranger has since taken could answer.
    const dataDir = makeTempDir("inteligir-guard-stale-");
    rowFor(dataDir, await wedgedListener(), await reapedPid());

    await expect(assertNoLiveServer(dataDir)).resolves.toBeUndefined();
  });

  it("proceeds when the connection is refused, whatever the pid says", async () => {
    // A refusal is an ANSWER. A pid this row's owner no longer holds must not
    // make the boot permanently unstartable.
    const dataDir = makeTempDir("inteligir-guard-refused-");
    rowFor(dataDir, await freePort(), process.pid);

    await expect(assertNoLiveServer(dataDir)).resolves.toBeUndefined();
  });
});
