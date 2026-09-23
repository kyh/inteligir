// a worker thread needs a real file: the build stages `<name>.mjs` beside the bundle, and a
// checkout runs `<name>.ts` from source. node cannot load that source bare (the workspace
// packages export extensionless TypeScript), so it runs under tsx's hook, named rather than
// inherited because a parent not itself under tsx (vitest) has none to pass on.

import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { WorkerOptions } from "node:worker_threads";

export interface WorkerEntry {
  path: string;
  options: Pick<WorkerOptions, "execArgv">;
}

export const resolveWorkerEntry = (moduleDir: string, name: string): WorkerEntry => {
  const bundled = path.join(moduleDir, `${name}.mjs`);
  if (existsSync(bundled)) {
    return { options: {}, path: bundled };
  }
  const source = path.join(moduleDir, `${name}.ts`);
  if (existsSync(source)) {
    const tsx = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;
    return { options: { execArgv: ["--import", tsx] }, path: source };
  }
  throw new Error(`worker entry not found in ${moduleDir} (looked for ${name}.mjs, ${name}.ts)`);
};
