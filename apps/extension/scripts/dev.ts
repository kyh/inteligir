// `pnpm dev:extension`: writes this checkout's browser door once (`inteligir native-host
// --install`), then rebuilds the pages and the capture script on every change into dist/, which
// Chrome loads unpacked.

import { spawn, spawnSync } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const repoRoot = path.resolve(root, "..", "..");

const runOnce = (args: readonly string[], cwd: string): number =>
  spawnSync("pnpm", args, { cwd, stdio: "inherit" }).status ?? 1;

// the door first: a build Chrome loads before it can reach nothing
const installed = runOnce(["cli", "native-host", "--install"], repoRoot);
// one whole build, which empties dist/ of what an older build left
const built = installed === 0 ? runOnce(["run", "build"], root) : installed;

if (built === 0) {
  // the pages' watch keeps dist/ as it is on each rebuild, since the capture script is its own
  // build's file beside them
  const watches: ChildProcess[] = [
    spawn("pnpm", ["exec", "vite", "build", "--mode", "dev", "--watch", "--emptyOutDir=false"], {
      cwd: root,
      stdio: "inherit",
    }),
    spawn(
      "pnpm",
      ["exec", "vite", "build", "--config", "vite.capture.config.ts", "--mode", "dev", "--watch"],
      { cwd: root, stdio: "inherit" },
    ),
  ];
  const stop = (): void => {
    for (const watch of watches) {
      watch.kill("SIGTERM");
    }
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  // either watch ending ends the loop, so a broken config is not half a dev build
  for (const watch of watches) {
    watch.on("exit", (code) => {
      stop();
      process.exitCode = code ?? 1;
    });
  }
} else {
  process.exitCode = built;
}
