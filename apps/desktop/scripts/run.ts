// A pack step that is another program: its output is the pack's own, and a non-zero exit stops the
// pack.

import { spawnSync } from "node:child_process";
import type { SpawnSyncOptions } from "node:child_process";

export const run = (
  file: string,
  args: readonly string[],
  options: SpawnSyncOptions = {},
): void => {
  const result = spawnSync(file, args, { stdio: "inherit", ...options });
  if (result.status !== 0) {
    throw new Error(`${file} ${args.join(" ")} exited ${result.status ?? result.signal}`);
  }
};
