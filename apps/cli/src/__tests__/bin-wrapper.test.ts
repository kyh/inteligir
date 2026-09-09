import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { constants } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../server/__tests__/temp-dir";

const BIN = path.resolve(import.meta.dirname, "..", "..", "bin", "inteligir");

const stagedBin = (childSource: string): string => {
  const root = makeTempDir("inteligir-bin-wrapper-");
  mkdirSync(path.join(root, "bin"));
  mkdirSync(path.join(root, "dist"));
  // the extensionless bin runs as ESM only because the nearest package.json says `type: module`.
  writeFileSync(path.join(root, "package.json"), JSON.stringify({ type: "module" }));
  copyFileSync(BIN, path.join(root, "bin", "inteligir"));
  writeFileSync(path.join(root, "dist", "index.js"), childSource);
  return path.join(root, "bin", "inteligir");
};

interface Exit {
  code: number | null;
  signal: NodeJS.Signals | null;
}

const runBin = async (bin: string): Promise<Exit> =>
  // oxlint-disable-next-line promise/avoid-new -- bridges the child's "exit" and "error" events
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [bin], { stdio: "ignore" });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      resolve({ code, signal });
    });
  });

const exitOf = async (child: ChildProcess): Promise<Exit> =>
  // oxlint-disable-next-line promise/avoid-new -- bridges the child's "exit" event
  await new Promise((resolve) => {
    child.on("exit", (code, signal) => {
      resolve({ code, signal });
    });
  });

// one SIGINT exits clean, a second during the first exits 1; the 5s timer keeps an orphaned child out of the run.
const SIGNAL_CONTRACT_CHILD = `
let sigints = 0;
process.on("SIGINT", () => {
  sigints += 1;
  if (sigints > 1) process.exit(1);
  setTimeout(() => process.exit(0), 300);
});
process.on("SIGTERM", () => process.exit(0));
setTimeout(() => process.exit(3), 5_000);
process.stdout.write("up\\n");
`;

// detached makes the wrapper a group leader so `kill(-pid)` reaches wrapper and child like a terminal's ^C;
// resolves on `up` so no signal lands before the child's handler exists.
const runBinAsGroupLeader = async (bin: string): Promise<{ pid: number; exit: Promise<Exit> }> =>
  // oxlint-disable-next-line promise/avoid-new -- bridges the child's first "up" line on stdout
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [bin], {
      detached: true,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const { pid } = child;
    if (pid === undefined) {
      reject(new Error("the wrapper never spawned"));
      return;
    }
    child.on("error", reject);
    const exit = exitOf(child);
    let out = "";
    child.stdout.setEncoding("utf-8");
    child.stdout.on("data", (chunk: string) => {
      out += chunk;
      if (out.includes("up\n")) {
        resolve({ exit, pid });
      }
    });
  });

describe.skipIf(process.platform === "win32")("bin/inteligir", () => {
  it("lets a terminal's ^C reach the child ONCE — the process group already delivered it", async () => {
    const { pid, exit } = await runBinAsGroupLeader(stagedBin(SIGNAL_CONTRACT_CHILD));
    process.kill(-pid, "SIGINT");
    expect(await exit).toEqual({ code: 0, signal: null });
  });

  it("forwards a supervisor's by-pid SIGTERM, which no group delivers for it", async () => {
    const { pid, exit } = await runBinAsGroupLeader(stagedBin(SIGNAL_CONTRACT_CHILD));
    process.kill(pid, "SIGTERM");
    expect(await exit).toEqual({ code: 0, signal: null });
  });

  it("exits 128+n when the child dies by a signal outside the relayed set", async () => {
    const bin = stagedBin('process.kill(process.pid, "SIGABRT");\n');
    expect(await runBin(bin)).toEqual({ code: 128 + constants.signals.SIGABRT, signal: null });
  });

  it("exits 128+n when the child dies by a RELAYED signal — never 0", async () => {
    const bin = stagedBin('process.kill(process.pid, "SIGTERM");\n');
    expect(await runBin(bin)).toEqual({ code: 128 + constants.signals.SIGTERM, signal: null });
  });

  it("mirrors the child's own exit code", async () => {
    const bin = stagedBin("process.exit(7);\n");
    expect(await runBin(bin)).toEqual({ code: 7, signal: null });
  });
});
