// The bin wrapper's exit code is the truth about its child. The graceful
// SIGTERM path is `pnpm smoke:cli`'s; what is pinned here is the HARD death —
// a child killed by a signal (a native abort in onnxruntime, an OOM kill) —
// which must reach the wrapper's caller as 128+n, never as the 0 a relay
// handler swallowing a re-raised signal produces.
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

function runBin(bin: string): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolveExit, reject) => {
    const child = spawn(process.execPath, [bin], { stdio: "ignore" });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      resolveExit({ code, signal });
    });
  });
}

describe.skipIf(process.platform === "win32")("bin/inteligir", () => {
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
