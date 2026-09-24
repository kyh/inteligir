import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { bootTestApp, listenTestApp, makeTempDir, TEST_SERVER_TOKEN } from "./boot-app";
import { loopbackOrigin, writeServerFile } from "../server-file";
import { probeServerFile } from "../server-probe";

// spawnSync reaps the child before it returns, so nothing answers to this pid.
const exitedPid = (): number => spawnSync(process.execPath, ["-e", ""]).pid;

describe("probeServerFile", () => {
  it("answers none for a data dir no server has published into", async () => {
    await expect(probeServerFile(makeTempDir("inteligir-probe-empty-"))).resolves.toEqual({
      kind: "none",
    });
  });

  it("calls a row whose pid has exited dead, without dialing its port", async () => {
    const dataDir = makeTempDir("inteligir-probe-dead-");
    const row = {
      pid: exitedPid(),
      port: 4664,
      token: "t",
      vaultDir: `${dataDir}/vault`,
      version: "0.1.0-test",
    };
    writeServerFile(dataDir, row);
    let dialed = false;
    const probe = await probeServerFile(dataDir, async () => {
      dialed = true;
      await Promise.resolve();
      return { kind: "refused" as const };
    });
    expect(probe).toEqual({ kind: "dead-owner", row });
    expect(dialed).toBe(false);
  });

  it("reads a live server's identity at the bound port its row names", async () => {
    const booted = await bootTestApp();
    const { port } = await listenTestApp(booted);
    writeServerFile(booted.dataDir, {
      pid: process.pid,
      port,
      token: TEST_SERVER_TOKEN,
      vaultDir: booted.vaultDir,
      version: "0.1.0-test",
    });
    await expect(probeServerFile(booted.dataDir)).resolves.toMatchObject({
      identity: { dataDir: booted.dataDir, version: "0.1.0-test" },
      kind: "answered",
      origin: loopbackOrigin(port),
    });
  });

  it("calls a server that refuses the row's token refused, not silent", async () => {
    const booted = await bootTestApp();
    const { port } = await listenTestApp(booted);
    writeServerFile(booted.dataDir, {
      pid: process.pid,
      port,
      token: "not-this-boot",
      vaultDir: booted.vaultDir,
      version: "0.1.0-test",
    });
    await expect(probeServerFile(booted.dataDir)).resolves.toMatchObject({ kind: "refused" });
  });

  it("tells a 200 that names no server from one that does", async () => {
    const dataDir = makeTempDir("inteligir-probe-unreadable-");
    writeServerFile(dataDir, {
      pid: process.pid,
      port: 4664,
      token: "t",
      vaultDir: "/v",
      version: "0.1.0-test",
    });
    const probe = await probeServerFile(dataDir, async () => {
      await Promise.resolve();
      return { body: { hello: "world" }, kind: "answered" as const };
    });
    expect(probe.kind).toBe("unreadable");
  });
});
