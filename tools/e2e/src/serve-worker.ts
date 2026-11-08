// The Worker the suite boots (harness/cloud-worker.ts), alone, for a check that runs outside the
// suite: `pnpm smoke:desktop` points the packaged Mac app at it, so no check of the app loads
// production. Prints `[serve-worker] <origin>` on stdout once the Worker answers, and stops it on
// SIGTERM or SIGINT.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { launchCloudWorker } from "./harness/cloud-worker";
import { killAllLiveGroups } from "./harness/tracked-child";
import type { TrackedProcess } from "./harness/tracked-child";

const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");
const scratchDir = await mkdtemp(path.join(tmpdir(), "inteligir-worker-"));
const instances: TrackedProcess[] = [];

const stopAll = async (): Promise<void> => {
  for (const instance of instances.toReversed()) {
    try {
      await instance.stop();
    } catch (error) {
      console.error(`[serve-worker] ${instance.name}: ${String(error)}`);
      killAllLiveGroups("SIGKILL");
    }
  }
  await rm(scratchDir, { force: true, recursive: true });
};

const signals: NodeJS.Signals[] = ["SIGINT", "SIGTERM"];
for (const signal of signals) {
  process.once(signal, () => {
    void (async () => {
      await stopAll();
      process.exit(0);
    })();
  });
}

try {
  const worker = await launchCloudWorker({
    onLog: (line) => {
      console.error(`[serve-worker] ${line}`);
    },
    register: (instance) => {
      instances.push(instance);
    },
    repoRoot,
    scratchDir,
  });
  console.log(`[serve-worker] ${worker.origin}`);
} catch (error) {
  console.error(`[serve-worker] the Worker did not boot: ${String(error)}`);
  await stopAll();
  process.exit(1);
}
