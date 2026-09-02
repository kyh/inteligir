// The bin wrapper's exit code is the truth about its child, and its signal
// contract is the terminal's. Pinned here: the HARD death — a child killed by
// a signal (a native abort in onnxruntime, an OOM kill) — which must reach the
// wrapper's caller as 128+n, never as the 0 a relay handler swallowing a
// re-raised signal produces; a ^C, which the process GROUP delivers to the
// child itself and the wrapper must therefore not relay on top; and a
// supervisor's by-pid SIGTERM, which nothing but the wrapper can pass on.
//
// Driven over the REAL bin file, copied into a scratch layout shaped like the
// published artifact (package.json + bin/ + dist/index.js) so the stub
// `dist/index.js` IS the child it runs.

import { spawn } from "node:child_process";
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { constants } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../server/__tests__/temp-dir";

const BIN = resolve(import.meta.dirname, "..", "..", "bin", "inteligir");

function stagedBin(childSource: string): string {
  const root = makeTempDir("inteligir-bin-wrapper-");
  mkdirSync(join(root, "bin"));
  mkdirSync(join(root, "dist"));
  // The extensionless bin runs as ESM because the nearest package.json says
  // `type: module`; the staged layout needs one for the same reason the
  // published artifact ships one.
  writeFileSync(join(root, "package.json"), JSON.stringify({ type: "module" }));
  copyFileSync(BIN, join(root, "bin", "inteligir"));
  writeFileSync(join(root, "dist", "index.js"), childSource);
  return join(root, "bin", "inteligir");
}

interface Exit {
  code: number | null;
  signal: NodeJS.Signals | null;
}

function runBin(bin: string): Promise<Exit> {
  return new Promise((resolveExit, reject) => {
    const child = spawn(process.execPath, [bin], { stdio: "ignore" });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      resolveExit({ code, signal });
    });
  });
}

/** A child shaped like the server's signal contract: one SIGINT is a clean
 *  exit, a SECOND one while the first is still being honoured is impatience
 *  and leaves unclean; SIGTERM is a clean exit. The five-second exit is a
 *  watchdog so a wrapper that dies without its child cannot orphan it into
 *  the test run. */
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

/** The wrapper as its own process-group leader — what a shell makes of a
 *  foreground job — so `kill(-pid)` reaches wrapper and child both, exactly
 *  as a terminal's ^C does. Resolves once the child reports `up`, so a signal
 *  cannot land before its handler is installed. */
function runBinAsGroupLeader(bin: string): Promise<{ pid: number; exit: Promise<Exit> }> {
  return new Promise((resolveUp, reject) => {
    const child = spawn(process.execPath, [bin], {
      detached: true,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const pid = child.pid;
    if (pid === undefined) {
      reject(new Error("the wrapper never spawned"));
      return;
    }
    child.on("error", reject);
    const exit = new Promise<Exit>((resolveExit) => {
      child.on("exit", (code, signal) => {
        resolveExit({ code, signal });
      });
    });
    let out = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      out += chunk;
      if (out.includes("up\n")) resolveUp({ pid, exit });
    });
  });
}

describe.skipIf(process.platform === "win32")("bin/inteligir", () => {
  it("lets a terminal's ^C reach the child ONCE — the process group already delivered it", async () => {
    // The trap this pins: a wrapper relaying SIGINT hands the server a second
    // copy of the one the group delivered, which the server reads as
    // impatience — it leaves before the vault flush, exit 1.
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
    // The trap this pins: re-raising the child's fatal signal at a wrapper
    // that still holds a relay listener for it runs the relay against a dead
    // child instead of terminating, and the wrapper then exits 0 — a hard
    // server death reported as success.
    const bin = stagedBin('process.kill(process.pid, "SIGTERM");\n');
    expect(await runBin(bin)).toEqual({ code: 128 + constants.signals.SIGTERM, signal: null });
  });

  it("mirrors the child's own exit code", async () => {
    const bin = stagedBin("process.exit(7);\n");
    expect(await runBin(bin)).toEqual({ code: 7, signal: null });
  });
});
