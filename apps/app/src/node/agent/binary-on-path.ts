// The one PATH-walk spelling (agent boot and the status probe both ask):
// skip empty segments, first executable match wins, unreadable entries are
// skipped rather than thrown — a PATH dir the user cannot stat is not an
// answer about the binary.

import { accessSync, constants, statSync } from "node:fs";
import { delimiter, join } from "node:path";

export function binaryOnPath(name: string, env: NodeJS.ProcessEnv): string | null {
  for (const dir of (env.PATH ?? "").split(delimiter)) {
    if (dir.length === 0) continue;
    const candidate = join(dir, name);
    try {
      if (!statSync(candidate).isFile()) continue;
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      continue;
    }
  }
  return null;
}
