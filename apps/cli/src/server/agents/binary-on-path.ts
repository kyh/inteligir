// unreadable PATH entries are skipped rather than thrown: a dir the user cannot stat is not an answer about the binary.

import { accessSync, constants, statSync } from "node:fs";
import path from "node:path";

export const binaryOnPath = (name: string, env: NodeJS.ProcessEnv): string | null => {
  for (const dir of (env.PATH ?? "").split(path.delimiter)) {
    if (dir.length === 0) {
      continue;
    }
    const candidate = path.join(dir, name);
    try {
      if (!statSync(candidate).isFile()) {
        continue;
      }
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      continue;
    }
  }
  return null;
};
