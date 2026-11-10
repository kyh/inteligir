// The Worker the suite boots (harness/cloud-worker.ts), alone, for a check that runs outside the
// suite: `pnpm smoke:desktop` points the packaged Mac app at it, so no check of the app loads
// production. Prints `[serve-worker] <origin>` on stdout once the Worker answers, and stops it on
// SIGTERM or SIGINT.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { launchCloudWorker } from "./harness/cloud-worker";
import { openScope } from "./harness/scope";
import { killAllLiveGroups } from "./harness/tracked-child";

const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");
const scratchDir = await mkdtemp(path.join(tmpdir(), "inteligir-worker-"));
const said = (message: string): void => {
  console.error(`[serve-worker] ${message}`);
};
const scope = openScope({ err: said, out: said });

const stopAll = async (): Promise<void> => {
  if (!(await scope.close())) {
    killAllLiveGroups("SIGKILL");
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
    onLog: scope.log,
    register: scope.own,
    repoRoot,
    scratchDir,
  });
  console.log(`[serve-worker] ${worker.origin}`);
} catch (error) {
  console.error(`[serve-worker] the Worker did not boot: ${String(error)}`);
  await stopAll();
  process.exit(1);
}
